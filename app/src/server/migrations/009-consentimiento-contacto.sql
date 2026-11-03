-- Si quien se inscribe aceptó que la comunidad que organiza le escriba por correo sobre sus próximos
-- eventos: una casilla opcional y desmarcada en el formulario de inscripción. Va por pase, es decir por
-- evento: aceptar en un evento no vale para otro. El paquete para el programa de embajadores
-- (scripts/paquete-embajadores.mjs) exporta solo los correos de quienes la marcaron.
ALTER TABLE passes ADD COLUMN contact_consent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE passes ADD COLUMN contact_consent_at TEXT;
