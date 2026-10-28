'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { PrivateKey } from 'openpgp';
import { LockKeyhole, ShieldCheck, Send, Download, Loader2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { E2EE_PROTOCOL, type ConversationData, type RecoveryBundle } from '@/lib/messaging/e2ee-types';
import { downloadRecovery, loadPin, loadVault, loadRecoveryAck, saveRecoveryAck, savePin, saveVault } from '@/lib/messaging/e2ee-vault';

const cryptoLibrary = () => import('@/lib/messaging/e2ee-crypto');
export function SecureConversation({ threadId, locale, backHref }: { threadId: string; locale: string; backHref: string }) {
  const ar = locale === 'ar';
  const [data, setData] = useState<ConversationData | null>(null);
  const [bundle, setBundle] = useState<RecoveryBundle | null>(null);
  const [key, setKey] = useState<PrivateKey | null>(null);
  const [vaultReady, setVaultReady] = useState(false);
  const [pin, setPin] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [repeat, setRepeat] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [plain, setPlain] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const decryptCache = useRef(new Map<string, { ciphertext: string; body: string }>());
  const pendingPacket = useRef<{ body: string; id: string; ciphertext: string; proof: string; senderFingerprint: string; recipientFingerprint: string } | null>(null);
  const active = useRef(true);
  const revision = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lock = useCallback(() => { setKey(null); setPlain({}); setDraft(''); setPassphrase(''); setRepeat(''); decryptCache.current.clear(); pendingPacket.current = null; }, []);
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/messages/conversations/${threadId}?locale=${locale}`, { cache: 'no-store', headers: revision.current ? { 'If-None-Match': revision.current } : {} });
    if (response.status === 304) return;
    if (!response.ok) {
      if (active.current) { lock(); setData(null); setError(ar ? 'تعذر الوصول إلى المحادثة. تحقق من جلستك.' : 'Conversation inaccessible. Vérifiez votre session.'); }
      return;
    }
    const next = await response.json() as ConversationData;
    if (active.current) { revision.current = response.headers.get('ETag'); setData(next); }
  }, [threadId, locale, ar, lock]);
  useEffect(() => {
    active.current = true; revision.current = null;
    void refresh().catch(() => { if (active.current) setError(ar ? 'تعذر الاتصال.' : 'Connexion impossible.'); });
    const timer = setInterval(() => { if (!document.hidden) void refresh().catch(() => {}); }, 5000);
    return () => { active.current = false; clearInterval(timer); };
  }, [refresh, ar]);
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    lock(); setVaultReady(false); setPin(null); setConfirmed(false);
    Promise.all([loadVault(data.selfUserId), loadPin(data.selfUserId, data.peerUserId), loadRecoveryAck(data.selfUserId)]).then(([stored, savedPin, acknowledged]) => {
      if (!cancelled) { setBundle(stored ?? null); setPin(savedPin ?? null); setVaultReady(true); setRecoverySaved(Boolean(acknowledged)); }
    }).catch(() => { if (!cancelled) setError(ar ? 'التخزين المحلي غير متاح. فعّل تخزين المتصفح.' : 'Le stockage du navigateur est indisponible. Autorisez-le pour conserver votre clé protégée.'); });
    return () => { cancelled = true; };
    // Account changes must discard the previous account's unlocked key and decrypted messages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.selfUserId, data?.peerUserId, lock, ar]);
  useEffect(() => {
    if (!key) return;
    let timer: ReturnType<typeof setTimeout>;
    const activity = () => { clearTimeout(timer); timer = setTimeout(lock, 15 * 60 * 1000); };
    activity(); document.addEventListener('pointerdown', activity); document.addEventListener('keydown', activity);
    return () => { clearTimeout(timer); document.removeEventListener('pointerdown', activity); document.removeEventListener('keydown', activity); };
  }, [key, lock]);
  useEffect(() => {
    if (key && data?.selfIdentity && key.getFingerprint() !== data.selfIdentity.fingerprint) { lock(); setError(ar ? 'تغيرت هوية التشفير. تم قفل المحادثة.' : 'L’identité de chiffrement a changé. Conversation verrouillée.'); }
  }, [key, data?.selfIdentity, ar, lock]);
  const trusted = Boolean(data?.peerIdentity && pin === data.peerIdentity.fingerprint);
  useEffect(() => {
    if (!data || !key || !data.selfIdentity || !data.peerIdentity || !trusted) { setPlain({}); return; }
    let cancelled = false;
    const snapshot = data;
    void (async () => {
      const next: Record<string, string> = {}; const errors: string[] = [];
      const crypto = await cryptoLibrary();
      for (const message of snapshot.messages) {
        if (message.encryption !== E2EE_PROTOCOL || !message.ciphertext) continue;
        try {
          const cached = decryptCache.current.get(message.id);
          const own = message.senderUserId === snapshot.selfUserId;
          if (!own && message.senderUserId !== snapshot.peerUserId) throw new Error('wrong_sender');
          const text = cached?.ciphertext === message.ciphertext ? cached.body : await crypto.decryptMessage({ ciphertext: message.ciphertext, privateKey: key,
            sender: (own ? snapshot.selfIdentity : snapshot.peerIdentity)!, threadId, messageId: message.id, recipientUserId: own ? snapshot.peerUserId : snapshot.selfUserId });
          if (cancelled) return;
          decryptCache.current.set(message.id, { ciphertext: message.ciphertext, body: text }); next[message.id] = text;
        } catch { errors.push(message.id); }
      }
      if (!cancelled) { setPlain(next); setFailed(errors); }
    })();
    return () => { cancelled = true; };
  }, [data, key, trusted, threadId]);
  useEffect(() => {
    if (!data || document.hidden) return;
    const ids = data.messages.filter(message => message.senderUserId !== data.selfUserId && !message.readAt && (message.encryption === 'server-v1' || plain[message.id] !== undefined)).slice(0, 100).map(message => message.id);
    if (ids.length) void fetch(`/api/messages/conversations/${threadId}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }).catch(() => {});
  }, [plain, data, threadId]);

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data) return;
    setError('');
    if (!globalThis.isSecureContext) { setError(ar ? 'تتطلب المراسلة اتصال HTTPS أو localhost.' : 'La messagerie nécessite une connexion HTTPS ou localhost.'); return; }
    if (!data.selfIdentity && passphrase !== repeat) { setError(ar ? 'عبارتا المرور غير متطابقتين.' : 'Les phrases secrètes ne correspondent pas.'); return; }
    setBusy('key');
    try {
      const crypto = await cryptoLibrary();
      if (!data.selfIdentity) {
        const created = await crypto.createIdentity(data.selfUserId, passphrase);
        await saveRecoveryAck(data.selfUserId, false); await saveVault(created.bundle); setBundle(created.bundle); downloadRecovery(created.bundle); setRecoverySaved(false);
        const response = await fetch('/api/messages/identity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publicKey: created.bundle.publicKey, proof: created.proof }) });
        if (!response.ok) throw new Error('registration_failed');
        const registered = await response.json();
        if (registered.fingerprint !== created.fingerprint || registered.userId !== data.selfUserId) throw new Error('registration_mismatch');
        setKey(created.privateKey);
      } else {
        if (!bundle) throw new Error('recovery_required');
        setKey(await crypto.unlockIdentity(bundle, passphrase, data.selfIdentity));
      }
      setPassphrase(''); setRepeat(''); await refresh();
    } catch { setError(ar ? 'تعذر فتح المفتاح. تحقق من العبارة وملف الاسترداد.' : 'Impossible d’ouvrir la clé. Vérifiez votre phrase secrète et votre fichier de récupération.'); }
    finally { setBusy(null); }
  }
  async function restore(file: File | undefined) {
    if (!file || !data?.selfIdentity) return;
    setError(''); setBusy('restore');
    try {
      if (file.size > 40000) throw new Error('invalid_backup');
      const candidate = JSON.parse(await file.text()) as RecoveryBundle;
      const unlocked = await (await cryptoLibrary()).unlockIdentity(candidate, passphrase, data.selfIdentity);
      await saveRecoveryAck(data.selfUserId, true); await saveVault(candidate); setBundle(candidate); setKey(unlocked); setPassphrase(''); setRecoverySaved(true);
    } catch { setError(ar ? 'ملف الاسترداد أو العبارة غير صحيحة لهذا الحساب.' : 'Ce fichier ou cette phrase secrète ne correspond pas à la clé de ce compte.'); }
    finally { setBusy(null); }
  }
  function selectRecovery(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    void restore(file);
  }
  async function acknowledgeRecovery() {
    if (!data) return;
    try { await saveRecoveryAck(data.selfUserId, true); setRecoverySaved(true); }
    catch { setError(ar ? 'تعذر حفظ التأكيد.' : 'Impossible d’enregistrer la confirmation.'); }
  }
  async function trust() {
    if (!data?.peerIdentity || !confirmed || pin) return;
    try { await savePin(data.selfUserId, data.peerUserId, data.peerIdentity.fingerprint); setPin(data.peerIdentity.fingerprint); }
    catch { setError(ar ? 'تعذر حفظ التحقق.' : 'Impossible d’enregistrer la vérification.'); }
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data?.selfIdentity || !data.peerIdentity || !key || !trusted || !recoverySaved || data.closed || !draft.trim()) return;
    setBusy('send'); setError('');
    try {
      const body = draft.trim();
      let packet = pendingPacket.current;
      if (!packet || packet.body !== body || packet.senderFingerprint !== data.selfIdentity.fingerprint || packet.recipientFingerprint !== data.peerIdentity.fingerprint) {
        const id = crypto.randomUUID();
        const ciphertext = await (await cryptoLibrary()).encryptMessage({ version: 1, threadId, messageId: id, senderUserId: data.selfUserId, recipientUserId: data.peerUserId, body }, key, data.selfIdentity, data.peerIdentity);
        const proof = await (await cryptoLibrary()).signDelivery({ id, threadId, ciphertext }, key, data.selfIdentity, data.peerIdentity);
        packet = { body, id, ciphertext, proof, senderFingerprint: data.selfIdentity.fingerprint, recipientFingerprint: data.peerIdentity.fingerprint }; pendingPacket.current = packet;
      }
      const response = await fetch(`/api/messages/conversations/${threadId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: packet.id, ciphertext: packet.ciphertext, proof: packet.proof, senderFingerprint: packet.senderFingerprint, recipientFingerprint: packet.recipientFingerprint }) });
      if (!response.ok) throw new Error('send_failed');
      if (response.headers.get('X-Message-Id') !== packet.id) throw new Error('send_mismatch');
      setDraft(''); pendingPacket.current = null; await refresh(); bottom.current?.scrollIntoView({ behavior: 'smooth' });
    } catch { setError(ar ? 'تعذر إرسال الرسالة. تم الاحتفاظ بالمسودة.' : 'Envoi impossible. Votre brouillon est conservé ; aucun envoi non chiffré n’a été effectué.'); }
    finally { setBusy(null); }
  }

  return <section className="medic-panel overflow-hidden">
    <header className="border-b border-slate-100 p-5"><Link href={backHref} className="text-xs font-semibold text-brand-700">{ar ? 'الرسائل' : 'Messages'}</Link><div className="mt-2 flex items-center justify-between gap-4"><h1 className="text-lg font-bold">{data?.peerName || (ar ? 'المحادثة' : 'Conversation')}</h1><span className="flex items-center gap-2 text-xs font-semibold text-brand-700"><LockKeyhole className="h-4 w-4" />{ar ? 'تشفير من طرف إلى طرف للرسائل الجديدة' : 'Nouveaux messages : E2EE'}</span></div></header>
    {error && <p role="alert" className="m-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {!data ? <p className="p-8 text-sm text-slate-500">{ar ? 'جارٍ تحميل المحادثة…' : 'Chargement de la conversation…'}</p> : <>
      <div className="border-b border-slate-100 bg-sky-50/50 p-5">
        {!key && vaultReady && <form onSubmit={activate} className="space-y-3">
          <h2 className="text-sm font-bold">{!data.selfIdentity ? (ar ? 'تفعيل التشفير الخاص بالمراسلة' : 'Activer mon chiffrement de messagerie') : (ar ? 'فتح مفتاح المراسلة' : 'Déverrouiller ma messagerie')}</h2>
          <p className="text-xs leading-5 text-slate-600">{ar ? 'استخدم عبارة سرية منفصلة عن كلمة مرور الحساب. لن تُرسل العبارة أو المفتاح الخاص إلى Medic.' : 'Utilisez une phrase secrète distincte du mot de passe du compte. La phrase et la clé privée restent dans votre navigateur.'}</p>
          <label className="medic-label">{ar ? 'العبارة السرية للمراسلة' : 'Phrase secrète de messagerie'}<input data-testid="messaging-passphrase" type="password" autoComplete="off" value={passphrase} onChange={event => setPassphrase(event.target.value)} minLength={data.selfIdentity ? 1 : 16} maxLength={256} required className="medic-input" /></label>
          {!data.selfIdentity && <><label className="medic-label">{ar ? 'تأكيد العبارة السرية' : 'Confirmer la phrase secrète'}<input data-testid="messaging-passphrase-repeat" type="password" autoComplete="off" value={repeat} onChange={event => setRepeat(event.target.value)} minLength={16} maxLength={256} required className="medic-input" /></label><p className="text-xs leading-5 text-amber-800">{ar ? 'سيتم تنزيل ملف استرداد محمي. احتفظ بالملف والعبارة بشكل منفصل. لا يمكن استرجاع الرسائل المشفرة إذا فُقدا.' : 'Un fichier de récupération protégé sera téléchargé. Conservez-le et gardez la phrase séparément. Sans eux, ni un administrateur ni une réinitialisation du mot de passe ne pourront récupérer vos nouveaux messages.'}</p></>}
          {data.selfIdentity && !bundle ? <label className="medic-label">{ar ? 'استيراد ملف الاسترداد بعد إدخال العبارة' : 'Importer mon fichier de récupération après avoir saisi la phrase'}<input data-testid="messaging-recovery-file" type="file" accept=".json,application/json" disabled={Boolean(busy) || !passphrase} onChange={event => selectRecovery(event.currentTarget)} className="medic-input py-2" /></label> : <button disabled={Boolean(busy)} className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{data.selfIdentity ? (ar ? 'فتح المراسلة' : 'Déverrouiller') : (ar ? 'تفعيل وتنزيل ملف الاسترداد' : 'Activer et télécharger mon fichier de récupération')}</button>}
        </form>}
        {key && <div className="flex flex-wrap items-center gap-3"><ShieldCheck className="h-5 w-5 text-brand-600" /><p className="flex-1 text-sm font-semibold">{ar ? 'مفتاحك مفتوح في هذا المتصفح' : 'Votre clé est déverrouillée dans ce navigateur'}</p>{bundle && <button type="button" onClick={() => downloadRecovery(bundle)} className="flex items-center gap-2 rounded-lg border border-sky-200 px-3 py-2 text-xs font-semibold"><Download className="h-4 w-4" />{ar ? 'ملف الاسترداد' : 'Fichier de récupération'}</button>}<button type="button" onClick={lock} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">{ar ? 'قفل' : 'Verrouiller'}</button></div>}
        {key && !recoverySaved && <label className="mt-4 flex gap-2 text-xs leading-5 text-amber-900"><input data-testid="recovery-saved" type="checkbox" checked={recoverySaved} onChange={() => void acknowledgeRecovery()} />{ar ? 'حفظت ملف الاسترداد وأتذكر العبارة السرية.' : 'J’ai conservé mon fichier de récupération et ma phrase secrète.'}</label>}
        {data.selfIdentity && <details className="mt-4 rounded-xl border border-sky-100 bg-white p-3" open={!trusted}><summary className="cursor-pointer text-xs font-semibold">{ar ? 'التحقق من هوية الطرفين' : 'Vérifier l’identité des participants'}</summary><p className="mt-3 text-xs leading-5 text-slate-600">{ar ? 'قارن البصمتين مع الطرف الآخر عبر مكالمة أو وسيلة موثوقة قبل التأكيد.' : 'Comparez ces empreintes avec votre interlocuteur par téléphone ou un autre moyen de confiance avant de confirmer.'}</p><p className="mt-3 text-xs font-bold">{ar ? 'بصمتك' : 'Votre empreinte'}</p><code dir="ltr" data-testid="self-fingerprint" className="mt-1 block break-all text-xs">{data.selfIdentity.fingerprint}</code><p className="mt-3 text-xs font-bold">{data.peerName}</p><code dir="ltr" data-testid="peer-fingerprint" className="mt-1 block break-all text-xs">{data.peerIdentity?.fingerprint ?? (ar ? 'لم يفعّل الطرف الآخر مفتاحه بعد.' : 'Votre interlocuteur n’a pas encore activé sa clé.')}</code>
          {pin && data.peerIdentity && pin !== data.peerIdentity.fingerprint ? <p role="alert" className="mt-3 text-xs font-bold text-red-700">{ar ? 'تغيرت بصمة الطرف الآخر. الإرسال محظور.' : 'L’empreinte a changé. Envoi bloqué : aucune nouvelle clé n’a été acceptée.'}</p> : trusted ? <p className="mt-3 text-xs font-semibold text-brand-700">{ar ? 'تم التحقق من الهوية على هذا الجهاز.' : 'Identité vérifiée sur cet appareil.'}</p> : data.peerIdentity && key && <><label className="mt-3 flex gap-2 text-xs leading-5"><input data-testid="fingerprints-compared" type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{ar ? 'قارنت البصمتين مع الطرف الآخر عبر وسيلة موثوقة.' : 'J’ai comparé les empreintes avec mon interlocuteur par un moyen de confiance.'}</label><button type="button" onClick={() => void trust()} disabled={!confirmed} className="mt-3 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{ar ? 'تأكيد البصمتين' : 'Confirmer les empreintes'}</button></>}
        </details>}
      </div>
      <div className="max-h-[55vh] min-h-64 space-y-3 overflow-y-auto bg-slate-50/50 p-5" aria-label={ar ? 'الرسائل' : 'Historique des messages'}>
        {data.messages.length === 0 && <p className="py-8 text-center text-sm text-slate-500">{ar ? 'لا توجد رسائل بعد. فعّل المفتاح وتحقق من الهوية للبدء.' : 'Aucun message. Activez votre clé et vérifiez l’identité pour commencer.'}</p>}
        {data.messages.map(message => <div key={message.id} className={`flex ${message.senderUserId === data.selfUserId ? 'justify-end' : 'justify-start'}`}><article data-message-id={message.id} className={`max-w-[90%] rounded-2xl border p-3 text-sm sm:max-w-lg ${message.senderUserId === data.selfUserId ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white'}`}>
          <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-slate-500">{message.encryption === E2EE_PROTOCOL ? <><LockKeyhole className="h-3 w-3" />E2EE</> : (ar ? 'رسالة قديمة — تشفير الخادم، وليست من طرف إلى طرف' : 'Historique — chiffrement serveur, sans E2EE')}</p>
          <p dir="auto" className="whitespace-pre-wrap break-words">{message.encryption === 'server-v1' ? message.legacyBody : failed.includes(message.id) ? (ar ? 'تعذر التحقق من هذه الرسالة. لم يتم عرض محتواها.' : 'Impossible de vérifier ce message. Son contenu n’a pas été affiché.') : plain[message.id] ?? (ar ? 'رسالة مشفرة. افتح المفتاح وتحقق من الهوية للقراءة.' : 'Message chiffré. Déverrouillez et vérifiez l’identité pour le lire.')}</p><p className="mt-2 text-[10px] text-slate-400">{new Date(message.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Tunis' })}{message.readAt && message.senderUserId === data.selfUserId ? (ar ? ' · مقروءة' : ' · Lu') : ''}</p>
        </article></div>)}<div ref={bottom} />
      </div>
      {data.closed && <p className="border-t border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{ar ? 'هذه المحادثة مغلقة. يبقى السجل متاحًا للقراءة.' : 'Conversation clôturée. L’historique reste consultable.'}</p>}
      <form onSubmit={send} className="border-t border-slate-200 p-4"><p className="mb-3 text-xs leading-5 text-slate-500">{ar ? 'هذه المراسلة ليست مخصصة للطوارئ. المستندات في الملف الطبي تخضع لنظام تشفير منفصل.' : 'Cette messagerie n’est pas destinée aux urgences. Les documents du dossier médical utilisent leur propre système de chiffrement.'}</p><div className="flex items-end gap-3"><textarea data-testid="secure-message-body" aria-label={ar ? 'رسالتك المشفرة' : 'Votre message chiffré'} value={draft} onChange={event => setDraft(event.target.value)} disabled={!key || !trusted || !recoverySaved || data.closed || Boolean(busy)} maxLength={5000} rows={2} dir="auto" placeholder={ar ? 'اكتب رسالتك…' : 'Écrivez votre message…'} className="medic-textarea mt-0 min-w-0 flex-1 disabled:opacity-60" /><button type="submit" aria-label={ar ? 'إرسال رسالة مشفرة' : 'Envoyer le message chiffré'} disabled={!key || !trusted || !recoverySaved || data.closed || !draft.trim() || Boolean(busy)} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-600 text-white disabled:opacity-40">{busy === 'send' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}</button></div></form>
    </>}
  </section>;
}
