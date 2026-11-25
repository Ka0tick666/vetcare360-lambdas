
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
                throw new Error('El mensaje es obligatorio');
            }

            const eventId = data.event_id || record.messageId;

            if (!eventId) {
                throw new Error('Identificador de evento obligatorio');
            }

            const { error } = await supabase
                .from('informes')
                .upsert(
                    {
                        event_id: eventId,
                        tipo: data.type,
                        mensaje: data.mensaje.trim()
                    },
                    {
                        onConflict: 'event_id',
                        ignoreDuplicates: true
                    }
                );

            if (error) {
                throw new Error(error.message);
            }

            console.log('Evento procesado:', eventId);

        } catch (error) {

            console.error(
                'Error procesando mensaje:',
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
