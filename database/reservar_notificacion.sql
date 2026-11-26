CREATE OR REPLACE FUNCTION public.reservar_notificacion(
    p_event_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    reservado BOOLEAN;
BEGIN
    INSERT INTO public.notificaciones_informes AS n (
        event_id,
        estado,
        intentos,
        updated_at
    )
    VALUES (
        p_event_id,
        'procesando',
        1,
        now()
    )
    ON CONFLICT (event_id)
    DO UPDATE SET
        estado = 'procesando',
        intentos = n.intentos + 1,
        updated_at = now(),
        ultimo_error = NULL
    WHERE n.estado IN ('pendiente', 'error')
    RETURNING TRUE INTO reservado;

    RETURN COALESCE(reservado, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_notificacion(TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reservar_notificacion(TEXT)
TO service_role;