-- Aviso operativo a Rafa: cuándo se avisó que la fuente estaba caída (null = sin aviso abierto).
-- Aplicada como regintel_normativo_alertas_operativas.
alter table public.regintel_norm_fuentes add column if not exists alerta_enviada_en timestamptz;
