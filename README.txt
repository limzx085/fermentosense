FermentoSense - Monitoring Fermentasi Tempe Berbasis IoT
=========================================================

CARA MENJALANKAN
1. Ekstrak ZIP ini.
2. Klik dua kali "index.html" (disarankan Chrome atau Edge).
   Tidak perlu internet atau instalasi apa pun.

CARA MEMASUKKAN DATA SENSOR
Tinkercad/Wokwi berjalan di cloud, jadi datanya tidak mengalir otomatis ke website.
1. Jalankan simulasi, buka Serial Monitor, lalu salin teksnya.
2. Di dashboard, klik tombol "Tempel Data" atau tekan Ctrl+V.
   (Pilihan lain: tombol "Sumber Data" -> Simulator / Tempel Serial Monitor / USB Serial.)
3. Untuk mencoba tanpa perangkat: Pengaturan -> "Muat Data Contoh".

ATURAN NOTIFIKASI
- Suhu media > 38 C          : buzzer berbunyi + notifikasi suhu terlalu tinggi
- Kelembapan < 70 % atau > 90 % : notifikasi kelembapan tidak sesuai
- pH > 7,5                   : notifikasi kemungkinan fermentasi berlebihan
- Semua dalam batas          : status Normal
Batas dapat diubah di menu Pengaturan.

ISI FOLDER
- index.html, style.css, app.js     : website dashboard
- arduino/fermentosense_tinkercad   : sketch Arduino Uno untuk Tinkercad
- arduino/fermentosense_esp32_wokwi : sketch ESP32 (pengembangan dari proyek Wokwi tim)
Halaman "Bantuan" di dalam dashboard berisi tabel komponen, kode, dan format data.

CATATAN
- Riwayat dan pengaturan tersimpan di browser masing-masing (tidak dibagikan antar orang).
- USB Serial hanya didukung Chrome/Edge desktop; fitur lain berjalan di browser modern mana pun.
- Sketch ESP32 belum dijalankan langsung di Wokwi/perangkat asli.
