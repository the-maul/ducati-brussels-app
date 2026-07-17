/**
 * M7 — Saisie rapide d'un marchand partenaire (occasions).
 * La gestion complète (édition, contacts supplémentaires, activation) se fait
 * sur la page dédiée /tradein/partners. Le mode d'envoi (auto/semi-auto) est
 * un réglage général affiché sur la page Reprises.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { listPartners, addPartner, deletePartner, checkPartnersSchema } from './partners-api';
import { MOTO_BRANDS } from './reprise-wizard-data';
import { t } from '@/lib/i18n';

export function PartnersDialog({ open, onOpenChange, companyId }: { open: boolean; onOpenChange: (o: boolean) => void; companyId: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [brands, setBrands] = useState<Set<string>>(new Set());
  const toggleBrand = (b: string) => setBrands((p) => { const n = new Set(p); if (n.has(b)) n.delete(b); else n.add(b); return n; });

  const schemaQ = useQuery({ queryKey: ['partners-schema', companyId], queryFn: checkPartnersSchema, enabled: open });
  const partnersQ = useQuery({ queryKey: ['tradein-partners', companyId], queryFn: () => listPartners(companyId), enabled: open });

  const add = useMutation({
    mutationFn: () => addPartner(companyId, {
      name, first_name: firstName || null, company: company || null,
      email, phone: phone || null, brands: [...brands],
    }),
    onSuccess: () => {
      setName(''); setFirstName(''); setCompany(''); setEmail(''); setPhone(''); setBrands(new Set());
      qc.invalidateQueries({ queryKey: ['tradein-partners', companyId] });
    },
    onError: () => toast.error(t('tradein.errSave')),
  });
  const del = useMutation({
    mutationFn: (id: string) => deletePartner(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tradein-partners', companyId] }),
  });

  const partners = partnersQ.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('tradein.partners')}</DialogTitle>
          <DialogDescription>{t('tradein.partnersHint')}</DialogDescription>
        </DialogHeader>

        {schemaQ.data === false && (
          <p className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning">{t('tradein.migrationBanner')}</p>
        )}

        {/* Liste des marchands */}
        {partners.length === 0
          ? <p className="text-[13px] text-muted-foreground">{t('tradein.partnerNone')}</p>
          : (
            <div className="max-h-48 space-y-1.5 overflow-auto">
              {partners.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-[13px]">
                  <div className="min-w-0">
                    <p className="font-bold">
                      {[p.first_name, p.name].filter(Boolean).join(' ')}
                      {p.company && <span className="font-normal text-muted-foreground"> · {p.company}</span>}
                    </p>
                    <p className="truncate text-[12px] text-muted-foreground">
                      {[p.email, p.phone].filter(Boolean).join(' · ')} — {p.brands.length === 0 ? t('tradein.partnerAllBrands') : p.brands.join(', ')}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => del.mutate(p.id)}><Trash2 className="size-4 text-danger" /></Button>
                </div>
              ))}
            </div>
          )}

        {/* Ajout rapide */}
        <div className="rounded-md border border-dashed border-border p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input placeholder={t('tradein.partnerName')} value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder={t('tradein.partnerFirstName')} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            <Input placeholder={t('tradein.partnerCompany')} value={company} onChange={(e) => setCompany(e.target.value)} />
            <Input placeholder={t('tradein.partnerPhone')} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Input className="sm:col-span-2" placeholder={t('tradein.partnerEmail')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <p className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
            {t('tradein.partnerBrands')} <span className="font-normal normal-case">— {t('tradein.partnerAllBrands').toLowerCase()} si aucune cochée</span>
          </p>
          <div className="grid max-h-36 grid-cols-2 gap-x-4 gap-y-1 overflow-auto sm:grid-cols-3">
            {MOTO_BRANDS.filter((b) => b !== 'Autre').map((b) => (
              <label key={b} className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={brands.has(b)} onCheckedChange={() => toggleBrand(b)} /> {b}
              </label>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={() => add.mutate()} disabled={add.isPending || !name.trim() || !email.trim()}>
              {add.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} {t('tradein.partnerAdd')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
