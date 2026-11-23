-- M3 (Simon, 23/11/2026) : origine de la moto d'après le DCS : d'abord « Garantie activée par »,
-- sinon « Moto facturée à ». Seulement quand l'origine est vide : une valeur connue n'est jamais écrasée.
update public.vehicles
   set origin = coalesce(nullif(nullif(btrim(warranty_activated_by), ''), '-'), nullif(nullif(btrim(invoiced_to), ''), '-'))
 where nullif(btrim(origin), '') is null
   and coalesce(nullif(nullif(btrim(warranty_activated_by), ''), '-'), nullif(nullif(btrim(invoiced_to), ''), '-')) is not null;
