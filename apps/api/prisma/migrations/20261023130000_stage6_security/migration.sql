-- Не больше одной открытой заявки на возврат по отправлению (защита от гонки двух запросов)
CREATE UNIQUE INDEX "return_requests_one_open_per_shipment" ON "return_requests" ("shipmentId") WHERE status = 'requested';
