import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DYNAMODB_TABLE;

export const handler = async (event) => {
  if (!TABLE_NAME) {
    throw new Error("DYNAMODB_TABLE no configurada");
  }

  if (
    typeof event?.event_id !== "string" ||
    !event.event_id.trim()
  ) {
    throw new Error("event_id es obligatorio");
  }

  if (
    typeof event.type !== "string" ||
    !event.type.trim()
  ) {
    throw new Error("type es obligatorio");
  }

  const item = {
    event_id: event.event_id.trim(),
    tipo: event.type,
    compra_id: event.compra_id ?? null,
    origen: "kafka-consumer",
    simulacion: event.simulacion === true,
    datos: {
      total: event.total ?? null,
      moneda: event.moneda ?? null,
      estado: event.estado ?? null
    },
    created_at: new Date().toISOString()
  };

  try {
    await dynamodb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: "attribute_not_exists(event_id)"
      })
    );

    console.log("Evento registrado:", item.event_id);

    return {
      success: true,
      duplicate: false,
      event_id: item.event_id
    };

  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      console.log("Evento duplicado:", item.event_id);

      return {
        success: true,
        duplicate: true,
        event_id: item.event_id
      };
    }

    console.error("Error registrando evento:", error.name);
    throw error;
  }
};
