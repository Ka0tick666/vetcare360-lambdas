ALTER TABLE public.notificaciones_informes
ADD COLUMN IF NOT EXISTS email_estado TEXT
    NOT NULL DEFAULT 'pendiente'
    CHECK (
        email_estado IN (
            'pendiente',
            'procesando',
            'enviado',
            'error',
            'incierto'
        )
    ),
ADD COLUMN IF NOT EXISTS email_enviado_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS email_id TEXT,
ADD COLUMN IF NOT EXISTS email_intentos INTEGER
    NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS email_ultimo_error TEXT;