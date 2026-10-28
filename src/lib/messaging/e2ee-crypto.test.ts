import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pgp from 'openpgp';
import { signDelivery, verifyDelivery, createIdentity, decryptMessage, encryptMessage, readPublicIdentity, unlockIdentity, validateCiphertext, verifyIdentityProof } from './e2ee-crypto';
import type { MessagePayload, PublicIdentity } from './e2ee-types';

const passphrase = 'Correct-Messaging-Secret-Only-For-Tests';
const alice = await createIdentity('alice', passphrase);
const bob = await createIdentity('bob', passphrase);
const outsider = await createIdentity('outsider', passphrase);
const identity = (userId: string, key: typeof alice): PublicIdentity => ({ userId, publicKey: key.bundle.publicKey, fingerprint: key.fingerprint });
const a = identity('alice', alice); const b = identity('bob', bob);
const payload: MessagePayload = { version: 1, threadId: 'thread-a', messageId: 'message-a', senderUserId: 'alice', recipientUserId: 'bob', body: 'نتائج التحاليل — Bonjour, docteur.' };
const ciphertext = await encryptMessage(payload, alice.privateKey, a, b);
const receive = { ciphertext, privateKey: bob.privateKey, sender: a, threadId: payload.threadId, messageId: payload.messageId, recipientUserId: 'bob' };

test('both participants decrypt and verify the same signed message', async () => {
  assert.equal(await decryptMessage(receive), payload.body);
  assert.equal(await decryptMessage({ ...receive, privateKey: alice.privateKey }), payload.body);
  assert.ok(!ciphertext.includes(payload.body));
  await validateCiphertext(ciphertext, [a, b]);
});
test('a third party cannot decrypt an intercepted message', async () => {
  await assert.rejects(() => decryptMessage({ ...receive, privateKey: outsider.privateKey }));
});
test('a valid message cannot be replayed into another thread, row or recipient', async () => {
  for (const change of [{ threadId: 'thread-b' }, { messageId: 'message-b' }, { recipientUserId: 'outsider' }]) await assert.rejects(() => decryptMessage({ ...receive, ...change }));
});
test('a forged sender signature is rejected even when the encryption recipients are correct', async () => {
  const forged = await pgp.encrypt({ message: await pgp.createMessage({ text: JSON.stringify(payload) }), encryptionKeys: await Promise.all([readPublicIdentity(a.publicKey), readPublicIdentity(b.publicKey)]), signingKeys: outsider.privateKey, format: 'armored' });
  await assert.rejects(() => decryptMessage({ ...receive, ciphertext: forged }));
});
test('a substituted public certificate cannot claim a previously pinned fingerprint', async () => {
  await assert.rejects(() => encryptMessage(payload, alice.privateKey, a, { ...b, publicKey: outsider.bundle.publicKey }));
  await assert.rejects(() => decryptMessage({ ...receive, sender: { ...a, publicKey: outsider.bundle.publicKey } }));
});
test('identity registration proves possession of the account-bound private key', async () => {
  assert.equal(await verifyIdentityProof('alice', a.publicKey, alice.proof), a.fingerprint);
  await assert.rejects(() => verifyIdentityProof('bob', a.publicKey, alice.proof));
  await assert.rejects(() => readPublicIdentity(alice.bundle.privateKey));
});
test('recovery requires the protected file, its phrase and the correct account', async () => {
  assert.equal((await unlockIdentity(alice.bundle, passphrase, a)).getFingerprint(), a.fingerprint);
  await assert.rejects(() => unlockIdentity(alice.bundle, 'incorrect-passphrase', a));
  await assert.rejects(() => unlockIdentity(alice.bundle, passphrase, b));
  await assert.rejects(() => unlockIdentity({ ...alice.bundle, privateKey: alice.privateKey.armor() }, passphrase, a));
});
test('the server accepts only encrypted packets addressed to the registered participants', async () => {
  await assert.rejects(() => validateCiphertext('-----BEGIN PGP MESSAGE-----\nplaintext', [a, b]));
  const plaintextPacket = (await pgp.createMessage({ text: payload.body })).armor();
  await assert.rejects(() => validateCiphertext(plaintextPacket, [a, b]));
  await assert.rejects(() => validateCiphertext(ciphertext, [a, identity('outsider', outsider)]));
});

test('delivery signatures reject replay into another thread or message ID before storage', async () => {
  const args = { id: payload.messageId, threadId: payload.threadId, ciphertext };
  const proof = await signDelivery(args, alice.privateKey, a, b);
  await verifyDelivery({ ...args, proof }, a, b);
  await assert.rejects(() => verifyDelivery({ ...args, proof, threadId: 'other-thread' }, a, b));
  await assert.rejects(() => verifyDelivery({ ...args, proof, id: 'other-message' }, a, b));
  await assert.rejects(() => verifyDelivery({ ...args, proof, ciphertext: ciphertext + 'modified' }, a, b));
});
