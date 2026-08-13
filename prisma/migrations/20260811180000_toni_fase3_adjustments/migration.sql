-- Rename Toni CRM status: visita_programada → cita_programada
ALTER TYPE "LeadStatus" RENAME VALUE 'visita_programada' TO 'cita_programada';

-- SMS channel for final fallback
ALTER TYPE "Channel" ADD VALUE IF NOT EXISTS 'sms';
