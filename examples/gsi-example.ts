import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { Table, type TableConfig } from "../src";

// Define entity types for our single-table design
type EntityType = "DINOSAUR" | "FOSSIL" | "HABITAT" | "PERIOD";

// Define base entity interface with common attributes
interface BaseEntity extends Record<string, unknown> {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi2pk: string;
  gsi3pk: string;

  entityType: EntityType;
  createdAt: string;
  updatedAt: string;
}

// Define dinosaur entity
interface Dinosaur extends BaseEntity {
  entityType: "DINOSAUR";
  dinoId: string;
  species: string;
  diet: "Carnivore" | "Herbivore" | "Omnivore";
  periodId: string;
  length: number;
  weight: number;
  habitatId: string;
}

// Define period entity
interface Period extends BaseEntity {
  entityType: "PERIOD";
  periodId: string;
  name: string;
  startMya: number; // millions of years ago
  endMya: number;
}

// Define habitat entity
interface Habitat extends BaseEntity {
  entityType: "HABITAT";
  habitatId: string;
  name: string;
  climate: string;
  terrain: string;
}

// Define fossil entity
interface Fossil extends BaseEntity {
  entityType: "FOSSIL";
  fossilId: string;
  dinoId: string;
  discoveryLocation: string;
  discoveryDate: string;
  completeness: number; // percentage of skeleton found
}

// Define table configuration with GSIs
interface DinoTableConfig extends TableConfig {
  indexes: {
    partitionKey: string;
    sortKey: string;
    gsis: {
      gsi1: {
        partitionKey: string;
        sortKey?: string;
      };
      gsi2: {
        partitionKey: string;
        sortKey?: string;
      };
      gsi3: {
        partitionKey: string;
        sortKey?: string;
      };
    };
  };
}

// Create DynamoDB client
const client = DynamoDBDocument.from(new DynamoDBClient({}));

// Create table instance with the typed configuration
const dinoTable = new Table<DinoTableConfig>({
  client,
  tableName: "DinosaurData",
  indexes: {
    partitionKey: "pk",
    sortKey: "sk",
    gsis: {
      gsi1: {
        partitionKey: "gsi1pk",
      },
      gsi2: {
        partitionKey: "gsi2pk",
      },
      gsi3: {
        partitionKey: "gsi3pk",
      },
    },
  },
});

async function getDinosaursBySpecies(species: string): Promise<Dinosaur[]> {
  const result = await dinoTable
    .query<Dinosaur>({
      pk: species,
    })
    .useIndex("gsi1")
    .execute();

  return result.items;
}

async function getDinosaursByPeriod(periodId: string): Promise<Dinosaur[]> {
  const result = await dinoTable
    .query<Dinosaur>({
      pk: periodId,
    })
    .useIndex("gsi2")
    .execute();

  return result.items;
}

async function getDinosaursByHabitat(habitatId: string): Promise<Dinosaur[]> {
  const result = await dinoTable
    .query<Dinosaur>({
      pk: habitatId,
    })
    .useIndex("gsi3")
    .execute();

  return result.items;
}

async function getDinosaurWithFossils(dinoId: string): Promise<{
  dinosaur: Dinosaur | undefined;
  fossils: Fossil[];
}> {
  // Get the dinosaur
  const dinoResult = await dinoTable
    .query<Dinosaur>({
      pk: `DINOSAUR#${dinoId}`,
      sk: (op) => op.eq(`METADATA#${dinoId}`),
    })
    .execute();

  // Get all fossils for this dinosaur
  const fossilsResult = await dinoTable
    .query<Fossil>({
      pk: `DINOSAUR#${dinoId}`,
      sk: (op) => op.beginsWith("FOSSIL#"),
    })
    .execute();

  return {
    dinosaur: dinoResult.items[0],
    fossils: fossilsResult.items,
  };
}

// Example function demonstrating the type safety
async function demonstrateTypeSafety(page: Record<string, unknown>) {
  // This would cause a TypeScript error because "NonExistentIndex" is not a valid GSI
  // const result = await dinoTable
  //   .query<Dinosaur>({
  //     pk: "some-value",
  //   })
  //   .useIndex("NonExistentIndex")
  //   .execute();

  const result = await dinoTable
    .query<Dinosaur>({
      pk: "PERIOD#jurassic",
    })
    .useIndex("gsi2") // TypeScript will validate that "PeriodIndex" exists
    .limit(10)
    .sortDescending()
    .startFrom(page)
    .execute();

  return result.items;
}

async function createDinosaur(
  dinoData: Omit<Dinosaur, "pk" | "sk" | "createdAt" | "updatedAt" | "entityType">,
): Promise<Dinosaur> {
  const now = new Date().toISOString();

  const dinosaur = {
    ...dinoData,
    pk: `DINOSAUR#${dinoData.dinoId}`,
    sk: `METADATA#${dinoData.dinoId}`,
    entityType: "DINOSAUR" as const,
    createdAt: now,
    updatedAt: now,
  } as Dinosaur;

  return await dinoTable.put(dinosaur).execute();
}

async function createFossil(
  fossilData: Omit<Fossil, "pk" | "sk" | "createdAt" | "updatedAt" | "entityType">,
): Promise<Fossil> {
  const now = new Date().toISOString();

  const newFossil = {
    ...fossilData,
    pk: `DINOSAUR#${fossilData.dinoId}`,
    sk: `FOSSIL#${fossilData.fossilId}`,
    entityType: "FOSSIL" as const,
    createdAt: now,
    updatedAt: now,
  } as Fossil;

  return await dinoTable.put(newFossil).execute();
}

async function updateDinosaurHabitat(dinoId: string, habitatId: string): Promise<void> {
  await dinoTable
    .update<Dinosaur>({
      pk: `DINOSAUR#${dinoId}`,
      sk: `METADATA#${dinoId}`,
    })
    .set("habitatId", habitatId)
    .set("updatedAt", new Date().toISOString())
    .execute();
}
