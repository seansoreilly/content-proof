import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function GET() {
  try {
    // Test Redis connection
    const testKey = "test:connection";
    const testValue = "hello-redis";
    
    // Set a test value
    await redis.set(testKey, testValue);
    
    // Get the test value
    const result = await redis.get(testKey);
    
    // Clean up
    if (typeof redis.del === 'function') {
      await redis.del(testKey);
    }
    
    return NextResponse.json({
      status: "success",
      message: "Redis connection working",
      testResult: result,
      redisType: redis.constructor?.name || "unknown"
    });
    
  } catch (error) {
    console.error("Redis test error:", error);
    return NextResponse.json({
      status: "error",
      message: "Redis connection failed",
      error: error instanceof Error ? error.message : "Unknown error",
      redisType: redis?.constructor?.name || "unknown"
    }, { status: 500 });
  }
} 