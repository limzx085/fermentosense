/*
  FermentoSense - ESP32 (Wokwi / perangkat asli)
  Pengembangan dari sketch_02.ino tim: ditambah sensor pH dan buzzer, serta keluaran 1 baris
  agar langsung terbaca dashboard.

  DS18B20 x3  : GPIO 4, 5, 18   -> suhu media (rata-rata 3 probe)
  DHT22       : GPIO 15         -> suhu udara + kelembapan
  Sensor pH   : GPIO 34 (ADC)   -> di Wokwi pakai potensiometer (0-3,3 V = pH 0-14)
  Buzzer      : GPIO 25         -> berbunyi jika suhu media > SUHU_MAX
  (butuh pustaka: OneWire, DallasTemperature, DHT sensor library; tone() butuh arduino-esp32 3.x)

  Keluaran Serial (115200 baud), satu baris per siklus:
  T=27.3;A=23.1;H=50.5;PH=6.80
*/
#include <OneWire.h>
#include <DallasTemperature.h>
#include <DHT.h>

const int DS18B20_1_PIN = 4;
const int DS18B20_2_PIN = 5;
const int DS18B20_3_PIN = 18;
const int PIN_PH        = 34;
const int PIN_BUZZER    = 25;
const float SUHU_MAX    = 38.0;

OneWire oneWire1(DS18B20_1_PIN);
OneWire oneWire2(DS18B20_2_PIN);
OneWire oneWire3(DS18B20_3_PIN);
DallasTemperature sensors1(&oneWire1);
DallasTemperature sensors2(&oneWire2);
DallasTemperature sensors3(&oneWire3);

#define DHTPIN 15
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(115200);
  sensors1.begin();
  sensors2.begin();
  sensors3.begin();
  dht.begin();
  pinMode(PIN_BUZZER, OUTPUT);
  analogReadResolution(12);
}

void loop() {
  sensors1.requestTemperatures();
  sensors2.requestTemperatures();
  sensors3.requestTemperatures();
  float t1 = sensors1.getTempCByIndex(0);
  float t2 = sensors2.getTempCByIndex(0);
  float t3 = sensors3.getTempCByIndex(0);

  // rata-rata probe yang terbaca (-127 = probe terputus)
  float jumlah = 0; int n = 0;
  if (t1 > -100) { jumlah += t1; n++; }
  if (t2 > -100) { jumlah += t2; n++; }
  if (t3 > -100) { jumlah += t3; n++; }
  float suhuMedia = n ? jumlah / n : NAN;

  float kelembapan = dht.readHumidity();
  float suhuUdara  = dht.readTemperature();
  float ph = analogRead(PIN_PH) * 14.0 / 4095.0;

  if (!isnan(suhuMedia) && suhuMedia > SUHU_MAX) tone(PIN_BUZZER, 1000);
  else noTone(PIN_BUZZER);

  if (isnan(suhuMedia) || isnan(kelembapan) || isnan(suhuUdara)) {
    Serial.println("Error: sensor gagal dibaca");
  } else {
    Serial.print("T=");   Serial.print(suhuMedia, 1);
    Serial.print(";A=");  Serial.print(suhuUdara, 1);
    Serial.print(";H=");  Serial.print(kelembapan, 1);
    Serial.print(";PH="); Serial.println(ph, 2);
  }
  delay(2000);   // DHT22 butuh jeda minimal 2 detik
}
