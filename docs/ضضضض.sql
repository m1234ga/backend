
ALTER VIEW [dbo].[VwLastDispensedBarcodeDep_Inner]
AS
SELECT WH.TransferOutDetail.ItemGUID, MAX(WH.TransferOut.TransferOutDate) AS LastDate, WH.TransferOut.TransferOutToGUID AS WarehouseGUID, MAX(WH.TransferOut.SeqID) AS Seq, WH.TransferOutDetail.BarcodeGUID
FROM     WH.TransferOut INNER JOIN
                  WH.TransferOutDetail ON WH.TransferOut.TransferOutGUID = WH.TransferOutDetail.TransferOutGUID INNER JOIN
                  Inventory.BackBone ON WH.TransferOutDetail.TransferOutDetailGUID = Inventory.BackBone.ReferenceDocumentDetailGUID
WHERE  (WH.TransferOut.TransferOutTypeGUID = 'Department') AND (Inventory.BackBone.QuantityBaseUnit < 0)
GROUP BY WH.TransferOutDetail.ItemGUID, WH.TransferOut.TransferOutToGUID, WH.TransferOutDetail.BarcodeGUID
GO



ALTER VIEW [dbo].[VwLastDispensedBarcode_Inner]
AS
SELECT Inventory.BackBone.ItemGUID, MAX(Inventory.BackBone.TransactionDateTime) AS LastDate, Inventory.BackBone.WarehouseGUID, MAX(Inventory.BackBone.SeqID) AS Seq, Inventory.BackBone.BarcodeGUID
FROM     Inventory.BackBone INNER JOIN
                  Inventory.BackboneMaxEntry ON Inventory.BackBone.ItemGUID = Inventory.BackboneMaxEntry.ItemGUID AND Inventory.BackBone.LocationGUID = Inventory.BackboneMaxEntry.LocationGUID AND 
                  Inventory.BackBone.BarcodeGUID = Inventory.BackboneMaxEntry.BarcodeGUID
WHERE  (Inventory.BackBone.QuantityBaseUnit < 0)
GROUP BY Inventory.BackBone.ItemGUID, Inventory.BackBone.WarehouseGUID, Inventory.BackBone.BarcodeGUID
GO



USE [EHRProduction]
GO

ALTER VIEW [dbo].[VwLastDispensedBarcodeInfoForTransfer]
AS
SELECT ISNULL(CAST(NEWID() AS VARCHAR(50)), '1') AS ID, dbo.VwLastDispensedBarcode_Inner.ItemGUID, dbo.VwLastDispensedBarcode_Inner.WarehouseGUID, dbo.VwLastDispensedBarcode_Inner.LastDate, 
                  ABS(Inventory.BackBone.ItemUnitQuantity) AS DispensedQty, WH.WHStpItem.FLItemName, WH.WHStpItemUnit.FLPackageName, Inventory.BackBone.ReferenceDocumentTypeGUID, Inventory.BackBone.ItemUnitGUID, 
                  WH.WHStpItem.ItemCode, Inventory.BackBone.BarcodeGUID, Inventory.Barcode.BarcodeNo
FROM     dbo.VwLastDispensedBarcode_Inner INNER JOIN
                  Inventory.BackBone ON dbo.VwLastDispensedBarcode_Inner.ItemGUID = Inventory.BackBone.ItemGUID AND dbo.VwLastDispensedBarcode_Inner.WarehouseGUID = Inventory.BackBone.WarehouseGUID AND 
                  dbo.VwLastDispensedBarcode_Inner.Seq = Inventory.BackBone.SeqID AND dbo.VwLastDispensedBarcode_Inner.LastDate = Inventory.BackBone.TransactionDateTime AND 
                  dbo.VwLastDispensedBarcode_Inner.BarcodeGUID = Inventory.BackBone.BarcodeGUID INNER JOIN
                  WH.WHStpItem ON dbo.VwLastDispensedBarcode_Inner.ItemGUID = WH.WHStpItem.ItemGUID INNER JOIN
                  WH.WHStpItemUnit ON Inventory.BackBone.ItemUnitGUID = WH.WHStpItemUnit.ItemUnitGUID AND Inventory.BackBone.ItemUnitGUID = WH.WHStpItemUnit.ItemUnitGUID INNER JOIN
                  Inventory.Barcode ON Inventory.BackBone.BarcodeGUID = Inventory.Barcode.BarcodeGUID

UNION ALL
SELECT ISNULL(CAST(NEWID() AS VARCHAR(50)), '1') AS ID, dbo.VwLastDispensedBarcodeDep_Inner.ItemGUID, dbo.VwLastDispensedBarcodeDep_Inner.WarehouseGUID, dbo.VwLastDispensedBarcodeDep_Inner.LastDate, 
                  ABS(WH.TransferOutDetail.ItemUnitQuantity) AS DispensedQty, WH.WHStpItem.FLItemName, WH.WHStpItemUnit.FLPackageName, 'DispenseTo' AS ReferenceDocumentTypeGUID, WH.TransferOutDetail.ItemUnitGUID, 
                  WH.WHStpItem.ItemCode, WH.TransferOutDetail.BarcodeGUID, WH.TransferOutDetail.BarcodeNumber
FROM     dbo.VwLastDispensedBarcodeDep_Inner INNER JOIN
                  WH.WHStpItem ON dbo.VwLastDispensedBarcodeDep_Inner.ItemGUID = WH.WHStpItem.ItemGUID INNER JOIN
                  WH.TransferOutDetail ON dbo.VwLastDispensedBarcodeDep_Inner.ItemGUID = WH.TransferOutDetail.ItemGUID INNER JOIN
                  WH.TransferOut ON WH.TransferOutDetail.TransferOutGUID = WH.TransferOut.TransferOutGUID AND WH.TransferOutDetail.TransferOutGUID = WH.TransferOut.TransferOutGUID AND 
                  dbo.VwLastDispensedBarcodeDep_Inner.WarehouseGUID = WH.TransferOut.TransferOutToGUID AND dbo.VwLastDispensedBarcodeDep_Inner.Seq = WH.TransferOut.SeqID INNER JOIN
                  WH.WHStpItemUnit ON WH.TransferOutDetail.ItemUnitGUID = WH.WHStpItemUnit.ItemUnitGUID INNER JOIN
                  HR.HRStpDepartment ON WH.TransferOut.TransferOutToGUID = HR.HRStpDepartment.DepartmentGUID
GO



