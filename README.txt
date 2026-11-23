FermentoSense - Monitoring Fermentasi Tempe Berbasis IoT
=========================================================

WEBSITE ONLINE
https://limzx085.github.io/fermentosense/
(GitHub Pages, otomatis diperbarui setiap ada push ke branch main)

CARA MENJALANKAN DI KOMPUTER SENDIRI
1. Unduh repo ini (Code -> Download ZIP) lalu ekstrak.
2. Klik dua kali "index.html" (disarankan Chrome atau Edge).
   Tidak perlu internet atau instalasi apa pun.

CARA MEMASUKKAN DATA SENSOR
Tinkercad/Wokwi berjalan di cloud, jadi datanya tidak mengalir otomatis ke website.
1. Jalankan simulasi, buka Serial Monitor, lalu salin teksnya.
2. Di dashboard, klik tombol "Tempel Data" atau tekan Ctrl+V.
   Data dari kode Google Colab: tempel teks CSV/JSON-nya, atau unggah/seret file .csv/.json
   ke halaman dashboard. Judul kolom yang dikenali: waktu, suhu_media, suhu_ruangan,
   kelembapan, pH (lihat halaman Bantuan untuk contoh kode Colab).
   (Pilihan lain: tombol "Sumber Data" -> Simulator / Tempel Serial Monitor / USB Serial / Model 3D.)
   Model 3D: simulasi perangkat di menu "Model 3D" mengirim data ke dashboard. Hubungkan lewat
   Sumber Data -> Model 3D, atau tombol "Kirim data ke dashboard" di panel Model 3D. Menghubungkan
   memulai batch baru; waktu grafik mengikuti jam simulasi (bisa dipercepat).
3. Untuk mencoba tanpa perangkat: Pengaturan -> "Muat Data Contoh".

ATURAN NOTIFIKASI
- Suhu media > 38 C          : buzzer berbunyi + notifikasi suhu terlalu tinggi
- Suhu ruangan > 38 C        : buzzer berbunyi + notifikasi suhu ruangan terlalu tinggi (aturan sama)
- Kelembapan < 70 % atau > 90 % : notifikasi kelembapan tidak sesuai
- pH > 7,5                   : notifikasi kemungkinan fermentasi berlebihan
- Semua dalam batas          : status Normal
Batas dapat diubah di menu Pengaturan.

ISI FOLDER
- index.html, style.css, app.js     : website dashboard
- logo.png, favicon.png, apple-touch-icon.png : ikon logo FermentoSense (sidebar & ikon tab browser)
  Tema situs: hijau-krem (gaya shadcn) – latar & kartu #f8f6f1, teks #303030, utama #4d9360,
  sekunder #E39A2D (pengganti biru #0062a8), aksen #c7e5c8, garis #e0d6c9, peringatan #c62828,
  sidebar #f0e9e0 dengan menu aktif #2e7d32, sudut 0.5rem, font Montserrat / Source Code Pro
  (dimuat dari Google Fonts; tanpa internet otomatis memakai font sistem).
  Semua token ada di bagian :root pada style.css.
  Mode gelap: otomatis mengikuti setelan sistem; tombol "Mode Gelap / Mode Terang" di sidebar
  mengganti tema dan pilihan itu diingat browser. Token gelap ada di :root[data-theme="dark"].
- fx.js, fx.css                     : efek animasi (smooth scroll Lenis, animasi GSAP, efek gaya React Bits:
                                      SplitText, AnimatedContent, SpotlightCard, ShinyText). Otomatis mati bila
                                      Windows/browser diatur "kurangi animasi" (prefers-reduced-motion).
- glass.css                         : gaya "glassy" (panel kaca buram, sidebar melayang, topbar pil, latar gradasi).
                                      Hapus baris <link ... glass.css> di index.html untuk kembali ke tampilan datar.
- vendor/                        : library lokal (tetap jalan tanpa internet)
                                      lenis 1.3.27 (MIT), gsap 3.15.1 + ScrollTrigger + SplitText (lisensi standar GSAP, gratis)
- model-3d-iot.html              : model 3D inkubator FermentoSense dengan logo (menu "Model 3D"; juga bisa dibuka sendiri)
                                   Interaktif: klik titik oranye / bagian model – tombol MODE & OK, LCD 3 halaman,
                                   LED status, buzzer (alarm > 38 °C), lampu pemanas (otomatis/nyala/mati),
                                   tutup bisa dibuka, power supply = saklar daya. Panel "Simulasi perangkat"
                                   menjalankan fermentasi 48 jam yang dipercepat (60×–3600×).
- arduino/fermentosense_tinkercad   : sketch Arduino Uno untuk Tinkercad
- arduino/fermentosense_esp32_wokwi : sketch ESP32 (pengembangan dari proyek Wokwi tim)
Halaman "Bantuan" di dalam dashboard berisi tabel komponen, kode, dan format data.

CATATAN
- Riwayat dan pengaturan tersimpan di browser masing-masing (tidak dibagikan antar orang).
- USB Serial hanya didukung Chrome/Edge desktop; fitur lain berjalan di browser modern mana pun.
- Sketch ESP32 belum dijalankan langsung di Wokwi/perangkat asli.
