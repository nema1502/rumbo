-- Los códigos de puesto pasan de ocho letras (cuarenta bits) a doce (sesenta): los de ocho se podían
-- probar a la fuerza. Los viejos se borran y el panel crea los nuevos la próxima vez que se abre
-- (ensureStationCodes); quien organiza les pasa a los voluntarios los códigos nuevos.
DELETE FROM station_codes WHERE length(code) < 12;
