import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_KEY) {
  throw new Error("Missing Supabase environment variables");
}

export const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Test database connection
async function testConnection() {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("count")
      .single();
    if (error) throw error;
    console.log("Database connected successfully");
  } catch (error) {
    console.error("Database connection error:", error);
  }
}

testConnection();
