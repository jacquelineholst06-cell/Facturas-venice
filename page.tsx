import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { documents } from "@/db/schema";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  let initialRecords = [];
  try {
    initialRecords = await getDb().select().from(documents).orderBy(desc(documents.issueDate));
  } catch {
    initialRecords = [];
  }
  return <Dashboard initialRecords={initialRecords} />;
}
