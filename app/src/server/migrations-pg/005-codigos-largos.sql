-- Los códigos de puesto pasan de ocho letras a doce (migrations/005-codigos-largos.sql): los viejos se borran y
-- el panel crea los nuevos la próxima vez que se abre.
DELETE FROM station_codes WHERE length(code) < 12;
