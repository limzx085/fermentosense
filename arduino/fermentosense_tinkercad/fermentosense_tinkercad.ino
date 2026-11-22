/*
  FermentoSense - versi Tinkercad Circuits (Arduino Uno)

  A0 : TMP36 pertama   -> suhu media    (pengganti DS18B20)
  A1 : TMP36 kedua     -> suhu ruangan  (pengganti suhu DHT22)
  A2 : Potensiometer 1 -> kelembapan    (pengganti kelembapan DHT22), 0-100 %
  A3 : Potensiometer 2 -> pH            (pengganti sensor pH),        0-14
  D8 : Piezo buzzer    -> bunyi jika suhu media ATAU suhu ruangan > SUHU_MAX

  Keluaran Serial (9600 baud), satu baris per detik:
  T=31.2;A=29.0;H=74.0;PH=5.70
*/

const int PIN_SUHU_MEDIA = A0;
const int PIN_SUHU_RUANGAN = A1;
const int PIN_RH         = A2;
const int PIN_PH         = A3;
const int PIN_BUZZER     = 8;

const float SUHU_MAX = 38.0;   // batas suhu media (derajat C)

// Baca TMP36 dan ubah ke derajat Celsius (rata-rata 10 kali agar stabil)
float bacaTMP36(int pin) {
  long total = 0;
  for (int i = 0; i < 10; i++) {
    total += analogRead(pin);
    delay(2);
  }
  float volt = (total / 10.0) * 5.0 / 1023.0;
  return (volt - 0.5) * 100.0;
}

void setup() {
  Serial.begin(9600);
  pinMode(PIN_BUZZER, OUTPUT);
}

void loop() {
  float suhuMedia  = bacaTMP36(PIN_SUHU_MEDIA);
  float suhuRuangan = bacaTMP36(PIN_SUHU_RUANGAN);
  float kelembapan = analogRead(PIN_RH) * 100.0 / 1023.0;
  float ph         = analogRead(PIN_PH) * 14.0 / 1023.0;

  // Buzzer: berbunyi saat suhu media ATAU suhu ruangan > 38 C
  if (suhuMedia > SUHU_MAX || suhuRuangan > SUHU_MAX) {
    tone(PIN_BUZZER, 1000);
  } else {
    noTone(PIN_BUZZER);
  }

  Serial.print("T=");   Serial.print(suhuMedia, 1);
  Serial.print(";A=");  Serial.print(suhuRuangan, 1);
  Serial.print(";H=");  Serial.print(kelembapan, 1);
  Serial.print(";PH="); Serial.println(ph, 2);

  delay(1000);
}
