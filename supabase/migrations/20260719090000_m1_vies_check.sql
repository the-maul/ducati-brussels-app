-- M1 — Vérification des numéros de TVA (BE + UE) via l'API REST officielle
-- VIES de la Commission européenne, appelée côté serveur (extension http)
-- pour contourner le blocage CORS du navigateur. Renvoie le JSON VIES brut :
-- { isValid, name, address, ... } ou { error } en cas d'indisponibilité.
create extension if not exists http with schema extensions;

create or replace function public.vies_check(_country text, _number text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  resp extensions.http_response;
begin
  resp := extensions.http_get(
    'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/'
    || upper(regexp_replace(_country, '[^A-Za-z]', '', 'g'))
    || '/vat/'
    || regexp_replace(_number, '[^A-Za-z0-9]', '', 'g')
  );
  if resp.status <> 200 then
    return jsonb_build_object('error', 'vies_http_' || resp.status::text);
  end if;
  return resp.content::jsonb;
exception when others then
  return jsonb_build_object('error', 'vies_unreachable');
end;
$$;

grant execute on function public.vies_check(text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
