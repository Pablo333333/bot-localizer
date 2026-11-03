-- Snapshot Fase 3 en Postgres (Railway). No modifica datos.
-- Ejecutar en el SQL console de Railway o: railway connect Postgres

-- 1) Leads por estado
SELECT status, COUNT(*) AS n
FROM "Lead"
GROUP BY status
ORDER BY n DESC;

-- 2) Candidatos no terminales (potencial seguimiento)
SELECT id, phone, status, source, "sheetsRowNumber", "updatedAt",
       metadata->>'last_phase' AS last_phase,
       metadata->>'last_outcome' AS last_outcome,
       metadata->>'nurturing_suppressed' AS suppressed
FROM "Lead"
WHERE status IN ('nuevo', 'pendiente', 'interesado')
ORDER BY "updatedAt" DESC
LIMIT 100;

-- 3) Enrollments activos + pasos abiertos (lo que BullMQ debería ejecutar)
SELECT e.id AS enrollment_id,
       l.phone,
       l.status AS lead_status,
       e.status AS enrollment_status,
       s."templateKey",
       sr.status AS step_status,
       sr."scheduledFor",
       sr."jobId",
       sr."lastError"
FROM "SequenceEnrollment" e
JOIN "Lead" l ON l.id = e."leadId"
JOIN "SequenceStepRun" sr ON sr."enrollmentId" = e.id
JOIN "SequenceStep" s ON s.id = sr."stepId"
WHERE e.status = 'active'
  AND sr.status IN ('pending', 'scheduled', 'processing')
ORDER BY sr."scheduledFor" ASC
LIMIT 200;

-- 4) Pasos ya vencidos (deberían salir hoy si el worker está up)
SELECT l.phone, s."templateKey", sr.status, sr."scheduledFor", sr."jobId"
FROM "SequenceStepRun" sr
JOIN "SequenceEnrollment" e ON e.id = sr."enrollmentId"
JOIN "Lead" l ON l.id = e."leadId"
JOIN "SequenceStep" s ON s.id = sr."stepId"
WHERE e.status = 'active'
  AND sr.status IN ('pending', 'scheduled', 'processing')
  AND sr."scheduledFor" <= NOW()
ORDER BY sr."scheduledFor" ASC;

-- 5) Ingest Sheets→Lead recientes (no es el dialer Fase 1)
SELECT id, phone, status, source, "sheetsRowNumber", "createdAt", "updatedAt"
FROM "Lead"
WHERE source = 'sheets_sync'
  AND "createdAt" >= NOW() - INTERVAL '7 days'
ORDER BY "createdAt" DESC
LIMIT 50;
