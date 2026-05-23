-- CreateTable
CREATE TABLE "ReceiptIssue" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reissueCount" INTEGER NOT NULL DEFAULT 0,
    "lastIssuedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReceiptIssue_shop_idx" ON "ReceiptIssue"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptIssue_shop_orderId_key" ON "ReceiptIssue"("shop", "orderId");
