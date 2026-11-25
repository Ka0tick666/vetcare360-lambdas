
import { createClient } from '@supabase/supabase-js';

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

async function obtenerProductos() {

    const { data, error } = await supabase
        .from('products')
        .select('name, price, stock')
        .not('price', 'is', null)
        .order('price', { ascending: false })
        .limit(10);

    if (error) {
        throw new Error(error.message);
    }

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

    const url = process.env.NOTICE_URL;
    const apiKey = process.env.NOTICE_API_KEY;

    if (!url || !apiKey) {
        throw new Error('Faltan variables del servicio de avisos');
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `ApiKey ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            text: texto
        }),
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

export const handler = async (event) => {

    const batchItemFailures = [];

    for (const record of event.Records ?? []) {

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

            const eventId = data.event_id || record.messageId;

            if (!eventId) {
                throw new Error('Identificador obligatorio');
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

            await enviarNotificacion(informe);

            console.log('Informe generado:', eventId);

        } catch (error) {

            console.error(
                'Error procesando evento:',
                record.messageId,
                error.message
            );

            batchItemFailures.push({
                itemIdentifier: record.messageId
            });
        }
    }

    return {
        batchItemFailures
    };
};
