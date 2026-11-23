-- M3 (retour de Domenico, 23/11/2026) : la cylindrée 1200 n'existe pas chez Ducati, c'est 1198 cm3.
-- Référentiels VIN et motos Ducati uniquement : une Triumph ou une BMW de 1200 reste à 1200.
update public.ducati_vin_model_specs set displacement_cc = 1198 where displacement_cc = 1200;
update public.ducati_vds set displacement_cc = 1198 where displacement_cc = 1200;
update public.vehicles set displacement = 1198
 where displacement = 1200 and upper(btrim(coalesce(brand, ''))) = 'DUCATI';
