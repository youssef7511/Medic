import * as pgp from 'openpgp';
import { E2EE_PROTOCOL, MAX_CIPHERTEXT_BYTES, MAX_MESSAGE_CHARS, type MessagePayload, type PublicIdentity, type RecoveryBundle } from './e2ee-types';

const CONFIG: Partial<pgp.Config> = { v6Keys: true, aeadProtect: true, maxDecompressedMessageSize: 64 * 1024 };
const proofText = (userId: string, fingerprint: string) => `medic:messaging-identity:v1:${userId}:${fingerprint}`;

export async function readPublicIdentity(publicKey: string) {
  if (publicKey.length > 16000 || !publicKey.startsWith('-----BEGIN PGP PUBLIC KEY BLOCK-----')) throw new Error('invalid_public_key');
  const key = await pgp.readKey({ armoredKey: publicKey });
  if (key.isPrivate()) throw new Error('invalid_public_key');
  await key.verifyPrimaryKey();
  await key.getEncryptionKey();
  await key.getSigningKey();
  return key;
}

async function checkedPublicIdentity(identity: PublicIdentity) {
  const key = await readPublicIdentity(identity.publicKey);
  if (key.getFingerprint() !== identity.fingerprint) throw new Error('identity_mismatch');
  return key;
}

export async function createIdentity(userId: string, passphrase: string) {
  if (passphrase.length < 16 || passphrase.length > 256) throw new Error('invalid_passphrase');
  const keys = await pgp.generateKey({ type: 'curve25519', userIDs: [{ name: 'Medic messaging' }], passphrase, format: 'armored', config: CONFIG });
  const key = await pgp.decryptKey({ privateKey: await pgp.readPrivateKey({ armoredKey: keys.privateKey }), passphrase });
  const fingerprint = key.getFingerprint();
  const proof = await pgp.sign({ message: await pgp.createMessage({ text: proofText(userId, fingerprint) }), signingKeys: key, detached: true });
  const bundle: RecoveryBundle = { version: 1, userId, publicKey: keys.publicKey, privateKey: keys.privateKey };
  return { bundle, privateKey: key, fingerprint, proof };
}

export async function verifyIdentityProof(userId: string, publicKey: string, proof: string) {
  const key = await readPublicIdentity(publicKey);
  const result = await pgp.verify({ message: await pgp.createMessage({ text: proofText(userId, key.getFingerprint()) }), signature: await pgp.readSignature({ armoredSignature: proof }), verificationKeys: key, expectSigned: true });
  await result.signatures[0]?.verified;
  if (result.signatures.length !== 1) throw new Error('invalid_identity_proof');
  return key.getFingerprint();
}

export async function unlockIdentity(bundle: RecoveryBundle, passphrase: string, expected: PublicIdentity) {
  if (bundle.version !== 1 || bundle.userId !== expected.userId || typeof bundle.privateKey !== 'string' || bundle.privateKey.length > 20000) throw new Error('wrong_recovery_file');
  const protectedKey = await pgp.readPrivateKey({ armoredKey: bundle.privateKey });
  if (protectedKey.isDecrypted()) throw new Error('unprotected_private_key');
  const key = await pgp.decryptKey({ privateKey: protectedKey, passphrase });
  if (key.getFingerprint() !== expected.fingerprint || (await readPublicIdentity(bundle.publicKey)).getFingerprint() !== expected.fingerprint) throw new Error('wrong_recovery_file');
  return key;
}

export async function encryptMessage(payload: MessagePayload, privateKey: pgp.PrivateKey, self: PublicIdentity, peer: PublicIdentity): Promise<string> {
  if (payload.senderUserId !== self.userId || payload.recipientUserId !== peer.userId || !payload.body.trim() || payload.body.length > MAX_MESSAGE_CHARS) throw new Error('invalid_message');
  if (privateKey.getFingerprint() !== self.fingerprint) throw new Error('wrong_identity');
  const ciphertext = await pgp.encrypt({ message: await pgp.createMessage({ text: JSON.stringify(payload) }), encryptionKeys: await Promise.all([checkedPublicIdentity(self), checkedPublicIdentity(peer)]), signingKeys: privateKey, format: 'armored', config: CONFIG });
  if (new TextEncoder().encode(ciphertext).length > MAX_CIPHERTEXT_BYTES) throw new Error('message_too_large');
  return ciphertext;
}

export async function decryptMessage(args: { ciphertext: string; privateKey: pgp.PrivateKey; sender: PublicIdentity; threadId: string; messageId: string; recipientUserId: string }): Promise<string> {
  const result = await pgp.decrypt({ message: await pgp.readMessage({ armoredMessage: args.ciphertext, config: CONFIG }), decryptionKeys: args.privateKey, verificationKeys: await checkedPublicIdentity(args.sender), expectSigned: true, format: 'utf8', config: CONFIG });
  if (result.signatures.length !== 1) throw new Error('invalid_signature');
  await result.signatures[0]!.verified;
  const payload = JSON.parse(result.data) as MessagePayload;
  if (payload.version !== 1 || payload.threadId !== args.threadId || payload.messageId !== args.messageId || payload.senderUserId !== args.sender.userId || payload.recipientUserId !== args.recipientUserId || typeof payload.body !== 'string' || !payload.body.trim() || payload.body.length > MAX_MESSAGE_CHARS) throw new Error('invalid_message_context');
  return payload.body;
}

function deliveryText(args: { id: string; threadId: string; ciphertext: string }, self: PublicIdentity, peer: PublicIdentity) {
  return JSON.stringify({ protocol: E2EE_PROTOCOL, id: args.id, threadId: args.threadId, senderUserId: self.userId, recipientUserId: peer.userId, ciphertext: args.ciphertext });
}
export async function signDelivery(args: { id: string; threadId: string; ciphertext: string }, privateKey: pgp.PrivateKey, self: PublicIdentity, peer: PublicIdentity): Promise<string> {
  if (privateKey.getFingerprint() !== self.fingerprint) throw new Error('wrong_identity');
  return pgp.sign({ message: await pgp.createMessage({ text: deliveryText(args, self, peer) }), signingKeys: privateKey, detached: true });
}
export async function verifyDelivery(args: { id: string; threadId: string; ciphertext: string; proof: string }, self: PublicIdentity, peer: PublicIdentity) {
  const result = await pgp.verify({ message: await pgp.createMessage({ text: deliveryText(args, self, peer) }), signature: await pgp.readSignature({ armoredSignature: args.proof }), verificationKeys: await checkedPublicIdentity(self), expectSigned: true });
  if (result.signatures.length !== 1) throw new Error('invalid_delivery_signature');
  await result.signatures[0]!.verified;
}

/** Inspect only public packet headers. No server code receives private keys or plaintext. */
export async function validateCiphertext(ciphertext: string, identities: PublicIdentity[]) {
  if (new TextEncoder().encode(ciphertext).length > MAX_CIPHERTEXT_BYTES || !ciphertext.startsWith('-----BEGIN PGP MESSAGE-----')) throw new Error('invalid_ciphertext');
  const message = await pgp.readMessage({ armoredMessage: ciphertext, config: CONFIG });
  const ids = message.getEncryptionKeyIDs().map(id => id.toHex());
  const expected = await Promise.all(identities.map(async identity => (await (await readPublicIdentity(identity.publicKey)).getEncryptionKey()).getKeyID().toHex()));
  if (ids.length !== expected.length || !expected.every(id => ids.includes(id))) throw new Error('invalid_recipients');
  const allowed = message.packets.filterByTag(pgp.enums.packet.publicKeyEncryptedSessionKey, pgp.enums.packet.symEncryptedIntegrityProtectedData);
  if (message.packets.length !== expected.length + 1 || allowed.length !== message.packets.length || message.packets.filterByTag(pgp.enums.packet.symEncryptedIntegrityProtectedData).length !== 1) throw new Error('invalid_ciphertext');
}

export { E2EE_PROTOCOL };
