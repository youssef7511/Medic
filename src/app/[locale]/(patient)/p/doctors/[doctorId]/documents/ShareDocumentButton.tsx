'use client';

import { useState, useActionState } from 'react';
import { Share2, X, Search, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { searchDoctorsAction, shareDocumentAction, revokeShareAction, type ShareState } from './actions';

interface DoctorResult {
  id: string;
  name: string;
  specialty: string;
}

interface ShareDocumentButtonProps {
  documentId: string;
  locale: string;
  hasShare: boolean;
  shareDoctorName?: string;
  shareId?: string;
}

export function ShareDocumentButton({
  documentId,
  locale,
  hasShare,
  shareDoctorName,
  shareId,
}: ShareDocumentButtonProps) {
  const ar = locale === 'ar';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [doctors, setDoctors] = useState<DoctorResult[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorResult | null>(null);
  const [searchPending, setSearchPending] = useState(false);
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);

  const [shareState, shareFormAction, sharePending] = useActionState<ShareState, FormData>(
    shareDocumentAction,
    {},
  );
  const [revokeState, revokeFormAction, revokePending] = useActionState<ShareState, FormData>(
    revokeShareAction,
    {},
  );

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearchPending(true);
    const fd = new FormData();
    fd.set('query', query);
    fd.set('locale', locale);
    const result = await searchDoctorsAction({ doctors: [] }, fd);
    setDoctors(result.doctors);
    setSearchPending(false);
  }

  function handleShare() {
    if (!selectedDoctor) return;
    const fd = new FormData();
    fd.set('locale', locale);
    fd.set('documentId', documentId);
    fd.set('targetDoctorId', selectedDoctor.id);
    shareFormAction(fd);
  }

  function handleRevoke() {
    if (!shareId) return;
    const fd = new FormData();
    fd.set('locale', locale);
    fd.set('shareId', shareId);
    revokeFormAction(fd);
  }

  // After successful share, close dialog and reset
  if (shareState.ok && open) {
    setTimeout(() => {
      setOpen(false);
      setQuery('');
      setDoctors([]);
      setSelectedDoctor(null);
    }, 0);
  }

  // After successful revoke, close confirm
  if (revokeState.ok && revokeConfirmOpen) {
    setTimeout(() => setRevokeConfirmOpen(false), 0);
  }

  // Already shared — show badge + revoke
  if (hasShare && shareDoctorName) {
    return (
      <>
        <div className="flex items-center gap-2">
          <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
            {ar ? 'مشارك مع' : 'Partagé avec'} {shareDoctorName}
          </span>
          <button
            type="button"
            onClick={() => setRevokeConfirmOpen(true)}
            className="text-xs text-red-600 hover:underline"
          >
            {ar ? 'إلغاء' : 'Révoquer'}
          </button>
        </div>

        <Dialog open={revokeConfirmOpen} onOpenChange={setRevokeConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{ar ? 'إلغاء المشاركة' : 'Révoquer le partage'}</DialogTitle>
              <DialogDescription>
                {ar
                  ? `هل تريد إلغاء المشاركة مع ${shareDoctorName}؟`
                  : `Révoquer le partage avec ${shareDoctorName} ?`}
              </DialogDescription>
            </DialogHeader>
            {revokeState.error && (
              <p role="alert" className="text-sm text-red-600">{revokeState.error}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRevokeConfirmOpen(false)}>
                {ar ? 'إلغاء' : 'Annuler'}
              </Button>
              <Button type="button" variant="destructive" disabled={revokePending} onClick={handleRevoke}>
                {ar ? 'تأكيد' : 'Confirmer'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Not shared — show share button + search dialog
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
      >
        <Share2 className="h-3 w-3" />
        {ar ? 'مشاركة' : 'Partager'}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ar ? 'مشاركة المستند' : 'Partager ce document'}</DialogTitle>
            <DialogDescription>
              {ar
                ? 'اختر طبيبًا لمشاركة الوصفة معه.'
                : 'Sélectionnez un médecin avec qui partager l\'ordonnance.'}
            </DialogDescription>
          </DialogHeader>

          {/* Search form */}
          <form onSubmit={(e) => void handleSearch(e)} className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={ar ? 'بحث عن طبيب…' : 'Rechercher un médecin…'}
              dir="auto"
              className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <Button type="submit" variant="outline" size="sm" disabled={searchPending || !query.trim()}>
              <Search className="h-4 w-4" />
            </Button>
          </form>

          {/* Results */}
          {doctors.length > 0 && (
            <ul className="max-h-48 divide-y divide-gray-100 overflow-y-auto rounded border border-gray-200">
              {doctors.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedDoctor(d)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-start text-sm hover:bg-gray-50 ${
                      selectedDoctor?.id === d.id ? 'bg-brand-50 ring-1 ring-brand-500' : ''
                    }`}
                  >
                    <div className="flex-1">
                      <p className="font-medium">{d.name}</p>
                      <p className="text-xs text-gray-500">{d.specialty}</p>
                    </div>
                    {selectedDoctor?.id === d.id && (
                      <Check className="h-4 w-4 shrink-0 text-brand-600" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {query && !searchPending && doctors.length === 0 && (
            <p className="text-sm text-gray-500">
              {ar ? 'لم يتم العثور على طبيب.' : 'Aucun médecin trouvé.'}
            </p>
          )}

          {shareState.error && (
            <p role="alert" className="text-sm text-red-600">{shareState.error}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {ar ? 'إلغاء' : 'Annuler'}
            </Button>
            <Button
              type="button"
              disabled={!selectedDoctor || sharePending}
              onClick={handleShare}
            >
              {ar ? 'مشاركة' : 'Partager'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
