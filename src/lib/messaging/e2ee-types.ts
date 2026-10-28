export const E2EE_PROTOCOL = 'openpgp-v1';
export const MAX_CIPHERTEXT_BYTES = 48 * 1024;
export const MAX_MESSAGE_CHARS = 5000;
export interface PublicIdentity { userId: string; publicKey: string; fingerprint: string }
export interface SecureMessage {
  id: string; senderUserId: string; createdAt: string; readAt: string | null;
  encryption: string; ciphertext: string | null; legacyBody: string | null;
}
export interface ConversationData {
  threadId: string; closed: boolean; selfUserId: string; peerUserId: string; peerName: string;
  selfIdentity: PublicIdentity | null; peerIdentity: PublicIdentity | null;
  messages: SecureMessage[];
}
export interface MessagePayload {
  version: 1; threadId: string; messageId: string; senderUserId: string; recipientUserId: string; body: string;
}
export interface RecoveryBundle { version: 1; userId: string; publicKey: string; privateKey: string }
