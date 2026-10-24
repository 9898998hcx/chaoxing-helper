ALTER TABLE "User" ADD COLUMN "custom_deepseek_key" TEXT;
ALTER TABLE "AiGenerationLog" ADD COLUMN "quotaExempt" BOOLEAN NOT NULL DEFAULT false;
