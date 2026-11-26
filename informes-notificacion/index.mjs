
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    }
);

async function reservarEvento(eventId) {

    const { data, error } = await supabase.rpc(
        'reservar_notificacion',
        { p_event_id: eventId }
    );

    if (error) throw new Error(error.message);

    return data === true;
}

async function consultarEstado(eventId) {

    const { data, error } = await supabase
        .from('notificaciones_informes')
        .select('*')
        .eq('event_id', eventId)
        .single();

    if (error) throw new Error(error.message);

    return data;
}

async function actualizarEstado(
    eventId,
    estado,
    errorMensaje = null
) {

    const cambios = {
        estado,
        updated_at: new Date().toISOString(),
        ultimo_error: errorMensaje
    };

    if (estado === 'enviado') {
        cambios.enviado_at = new Date().toISOString();
    }

    const { error } = await supabase
        .from('notificaciones_informes')
        .update(cambios)
        .eq('event_id', eventId)
        .eq('estado', 'procesando')
        .select('event_id')
        .single();

    if (error) throw new Error(error.message);
}

async function reservarEmail(eventId) {

    const registro = await consultarEstado(eventId);

    if (registro.email_estado === 'enviado') {
        return false;
    }

    const { data, error } = await supabase
        .from('notificaciones_informes')
        .update({
            email_estado: 'procesando',
            email_intentos: registro.email_intentos + 1,
            email_ultimo_error: null,
            updated_at: new Date().toISOString()
        })
        .eq('event_id', eventId)
        .eq('estado', 'enviado')
        .eq('email_intentos', registro.email_intentos)
        .in('email_estado', ['pendiente', 'error'])
        .select('event_id')
        .maybeSingle();

    if (error) throw new Error(error.message);

    if (!data) {
        const actual = await consultarEstado(eventId);

        if (actual.email_estado === 'enviado') {
            return false;
        }

        throw new Error(
            `Correo no disponible: ${actual.email_estado}`
        );
    }

    return true;
}

async function actualizarEmail(eventId, cambios) {

    const { error } = await supabase
        .from('notificaciones_informes')
        .update({
            ...cambios,
            updated_at: new Date().toISOString()
        })
        .eq('event_id', eventId)
        .eq('email_estado', 'procesando')
        .select('event_id')
        .single();

    if (error) throw new Error(error.message);
}

async function obtenerProductos() {

    const { data, error } = await supabase
        .from('products')
        .select('name, price, stock')
        .not('price', 'is', null)
        .order('price', { ascending: false })
        .limit(10);

    if (error) throw new Error(error.message);

    return data;
}

function generarInforme(evento, productos, eventId) {

    const formatoPrecio = new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP'
    });

    const lineas = [
        'VetCare360 - Informe de productos',
        `Evento: ${eventId}`,
        `Solicitud: ${evento.mensaje}`,
        '',
        `Los ${productos.length} productos más caros:`,
        '',
        ...productos.map((producto, index) =>
            `${index + 1}. ${producto.name} - ` +
            `${formatoPrecio.format(producto.price)} ` +
            `(Stock: ${producto.stock})`
        ),
        '',
        'Informe generado automáticamente por VetCare360.'
    ];

    return lineas.join('\n').slice(0, 2000);
}

async function enviarNotificacion(texto) {

    const response = await fetch(process.env.NOTICE_URL, {
        method: 'POST',
        headers: {
            Authorization: `ApiKey ${process.env.NOTICE_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text: texto }),
        redirect: 'manual',
        signal: AbortSignal.timeout(8000)
    });

    if (response.status !== 201) {
        throw new Error(
            `Servicio de avisos respondió HTTP ${response.status}`
        );
    }

    console.log('Aviso publicado correctamente: HTTP 201');
}

async function enviarCorreo(texto, eventId) {

    const idempotencyKey = createHash('sha256')
        .update(eventId)
        .digest('hex');

    const response = await fetch(
        'https://api.resend.com/emails',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': `vetcare360-${idempotencyKey}`
            },
            body: JSON.stringify({
                from: process.env.EMAIL_FROM,
                to: [process.env.EMAIL_TO],
                subject: 'VetCare360 - Informe de productos',
                text: texto
            }),
            redirect: 'manual',
            signal: AbortSignal.timeout(8000)
        }
    );

    if (!response.ok) {

        const error = new Error(
            `Resend respondió HTTP ${response.status}`
        );

        error.rechazado = [400, 401, 403, 422, 429]
            .includes(response.status);

        throw error;
    }

    const resultado = await response.json();

    if (!resultado.id) {
        throw new Error('Resend no devolvió identificador');
    }

    console.log('Correo aceptado por Resend:', resultado.id);

    return resultado.id;
}

export const handler = async (event) => {

    const batchItemFailures = [];

    for (const record of event.Records ?? []) {

        let eventId = null;
        let avisoReservado = false;
        let avisoIniciado = false;
        let avisoCompletado = false;
        let emailReservado = false;
        let emailIniciado = false;

        try {

            const data = JSON.parse(record.body);

            if (data.type !== 'informe') {
                throw new Error('Tipo de evento no válido');
            }

            if (
                typeof data.mensaje !== 'string' ||
                !data.mensaje.trim()
            ) {
                throw new Error('Mensaje obligatorio');
            }

            eventId = data.event_id || record.messageId;

            if (
                typeof eventId !== 'string' ||
                !eventId.trim()
            ) {
                throw new Error('Identificador obligatorio');
            }

            avisoReservado = await reservarEvento(eventId);

            if (!avisoReservado) {

                const registro = await consultarEstado(eventId);

                if (registro.estado !== 'enviado') {
                    throw new Error(
                        `Aviso no disponible: ${registro.estado}`
                    );
                }

                avisoCompletado = true;

                console.log('Aviso duplicado omitido:', eventId);

                if (registro.email_estado === 'enviado') {
                    console.log('Correo duplicado omitido:', eventId);
                    continue;
                }
            }

            const productos = await obtenerProductos();

            console.log(
                'Productos consultados:',
                productos.length
            );

            const informe = generarInforme(
                data,
                productos,
                eventId
            );

            if (avisoReservado) {

                if (
                    !process.env.NOTICE_URL ||
                    !process.env.NOTICE_API_KEY
                ) {
                    throw new Error(
                        'Faltan variables del servicio de avisos'
                    );
                }

                avisoIniciado = true;

                await enviarNotificacion(informe);

                await actualizarEstado(eventId, 'enviado');

                avisoCompletado = true;
            }

            if (
                !process.env.RESEND_API_KEY ||
                !process.env.EMAIL_FROM ||
                !process.env.EMAIL_TO
            ) {
                throw new Error(
                    'Faltan variables de correo electrónico'
                );
            }

            emailReservado = await reservarEmail(eventId);

            if (!emailReservado) {
                console.log('Correo duplicado omitido:', eventId);
                continue;
            }

            emailIniciado = true;

            const emailId = await enviarCorreo(informe, eventId);

            await actualizarEmail(eventId, {
                email_estado: 'enviado',
                email_enviado_at: new Date().toISOString(),
                email_id: emailId,
                email_ultimo_error: null
            });

            console.log('Informe completado:', eventId);

        } catch (error) {

            console.error(
                'Error procesando evento:',
                record.messageId,
                error.message
            );

            try {

                if (emailReservado) {

                    await actualizarEmail(eventId, {
                        email_estado:
                            !emailIniciado || error.rechazado
                                ? 'error'
                                : 'incierto',
                        email_ultimo_error:
                            error.message.slice(0, 500)
                    });

                } else if (
                    avisoReservado &&
                    !avisoIniciado &&
                    !avisoCompletado
                ) {

                    await actualizarEstado(
                        eventId,
                        'error',
                        error.message.slice(0, 500)
                    );

                } else if (
                    avisoReservado &&
                    avisoIniciado &&
                    !avisoCompletado
                ) {

                    console.error(
                        'Aviso incierto. Requiere revisión:',
                        eventId
                    );
                }

            } catch (dbError) {

                console.error(
                    'Error actualizando estado:',
                    dbError.message
                );
            }

            batchItemFailures.push({
                itemIdentifier: record.messageId
            });
        }
    }

    return { batchItemFailures };
};
