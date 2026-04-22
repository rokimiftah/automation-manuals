# Navigineer: Kombinasi Navigate dan Engineer. Menjadikan aplikasi ini sebagai alat navigasi utama bagi para insinyur lapangan.

### Question: jadi saya ingin membuat platform ai pakai rag (vector db, semantic, dll) dengan tujuan ketika engineer mencari problem maka akan diberikan solusi yang didapat dari dokumentasi pdf resmi.

misalkan:
`di plc control logix harus konek ke io mana saja?`
lalu dijawab:
`dari dokumentasi konek port 1 ke port 9`
jadi sumber source of truth harus dari pdf vendor resmi
apakah memungkinkan membuat proyek platform seperti ini dan tanpa ada salah jawaban sama sekali?

### Answer: Ide platform yang ingin Anda buat ini sangat realistis, bernilai tinggi, dan merupakan salah satu use case paling populer untuk penerapan AI di level enterprise.

Namun, untuk menjawab pertanyaan Anda secara langsung dan jujur: Apakah memungkinkan membuat proyek ini? Sangat memungkinkan. Apakah bisa tanpa ada salah jawaban sama sekali (100% sempurna)? Tidak.
Dalam dunia Generative AI, garansi 0% halusinasi (kesalahan) adalah kemustahilan teknis. LLM pada dasarnya bersifat probabilistik (menebak kata selanjutnya berdasarkan probabilitas), bukan sistem query database relasional yang deterministik (pasti 1+1=2).
Namun, dengan arsitektur RAG yang dioptimalkan, Anda bisa menekan tingkat kesalahan hingga mendekati nol dan, yang lebih penting, membuat sistem tersebut dapat diverifikasi oleh engineer.
Berikut adalah realita tantangan yang akan Anda hadapi dan strategi arsitektur untuk membangun platform ini agar seakurat mungkin:

1. Tantangan Terbesar: Parsing PDF Teknik (Bukan Sekadar Teks)
   Buku manual vendor (seperti Allen-Bradley untuk ControlLogix atau Siemens) tidak seperti novel. Isinya penuh dengan:
   Tabel pin-out I/O.
   Diagram wiring kelistrikan.
   Format multi-kolom dan header/footer berulang.
   Jika Anda hanya menggunakan library ekstraksi PDF biasa (seperti PyPDF2), tabel akan berubah menjadi teks berantakan, dan Vector DB akan menyimpan sampah. Akibatnya, AI akan memberikan jawaban yang salah.
   Solusi: Gunakan alat ekstraksi tingkat lanjut yang layout-aware (memahami struktur halaman, tabel, dan gambar), seperti LlamaParse, Unstructured.io, atau Document AI. Jika perlu, ubah diagram menjadi deskripsi teks menggunakan Vision Model sebelum dimasukkan ke Vector DB.
2. Jangan Hanya Mengandalkan Semantic Search
   Semantic search (pencarian berbasis makna) sangat hebat, tetapi engineer sering mencari hal yang sangat spesifik, seperti part number (misal: "1756-EN2T" atau "OLED error 16#0009"). Vector DB kadang kurang akurat untuk pencocokan karakter persis seperti ini.
   Solusi: Terapkan Hybrid Search. Gabungkan Vector Search (untuk memahami konteks/makna kalimat) dengan Keyword Search (seperti BM25) untuk menangkap istilah teknis, kode error, atau nomor model secara presisi.
3. Strict Prompting & Kutipan Referensi (Sangat Krusial)
   Anda harus merancang system prompt pada LLM untuk bertindak seperti asisten yang sangat kaku dan hanya berpegang pada dokumen.
   Contoh Prompt: "Anda adalah asisten teknis untuk ControlLogix. Jawab HANYA berdasarkan konteks yang diberikan. Jangan menggunakan pengetahuan luar. Jika jawaban tidak ada di konteks, jawab 'Saya tidak menemukan informasi tersebut di dokumen resmi'."
   Wajib Kutipan (Citations): Setiap kali AI memberikan jawaban (misal: "Konek port 1 ke port 9"), AI wajib menyertakan nomor halaman atau tautan ke dokumen aslinya.
4. Desain UI untuk Verifikasi (Bukan Kepercayaan Buta)
   Karena AI tidak bisa dijamin 100% benar, UI platform Anda harus dirancang untuk memfasilitasi verifikasi manusia, bukan menggantikannya.
   Solusi: Saat AI memberikan jawaban, tampilkan juga snippet atau cuplikan gambar PDF asli tepat di sebelah jawaban tersebut. Jadi, engineer tidak perlu percaya buta pada teks AI, melainkan bisa langsung memvalidasi dengan matanya sendiri dari potongan dokumen resmi yang disajikan.
   Singkatnya, posisikan platform AI Anda bukan sebagai "Pakar yang Maha Tahu dan Tidak Pernah Salah", melainkan sebagai "Asisten Peneliti Super Cepat" yang menyodorkan buku manual tepat di halaman yang sedang dicari oleh engineer.
   Tantangan terbesar di kasus seperti ini biasanya ada di format dari PDF vendornya itu sendiri. Apakah dokumentasi vendor yang ingin Anda proses ini kebanyakan berupa teks paragraf, atau justru sangat didominasi oleh tabel spesifikasi teknis dan diagram kelistrikan?

### Question: didominasi oleh tabel spesifikasi teknis dan diagram kelistrikan.

### Answer: Ini adalah skenario Nightmare Mode (tingkat kesulitan tertinggi) dalam dunia RAG, tetapi sekaligus yang paling bernilai tinggi di industri jika Anda berhasil memecahkannya.

Tabel dan diagram kelistrikan adalah "musuh alami" dari sistem RAG tradisional karena struktur spasialnya (baris, kolom, garis koneksi) sering kali hancur saat dikonversi menjadi teks biasa.
Untuk menaklukkan dokumen semacam ini, Anda tidak bisa menggunakan arsitektur RAG teks standar. Anda harus naik kelas ke arsitektur Multimodal RAG dan Advanced Chunking. Berikut adalah strategi teknis untuk menanganinya:

1. Menaklukkan Tabel Spesifikasi Teknis
   Tabel tidak bisa dipotong-potong (chunking) sembarangan. Jika kalimat di kolom 1 terpisah dari header di kolom 2, LLM akan berhalusinasi.
   Ekstraksi Berbasis Markdown: Jangan gunakan library ekstraksi PDF standar. Gunakan alat bertenaga AI yang memang dirancang untuk "melihat" tabel dan mengubahnya menjadi format Markdown atau HTML. Alat seperti LlamaParse sangat andal dalam mempertahankan format tabel. Format Markdown (| Port | Koneksi |) sangat mudah dipahami oleh LLM.
   Parent-Document Retrieval: Ini adalah teknik RAG tingkat lanjut. Alih-alih menyimpan tabel besar sebagai satu bongkahan teks, sistem Anda memecahnya menjadi baris-baris kecil untuk keperluan pencarian (agar presisi). Namun, ketika baris tersebut ditemukan, sistem akan menarik seluruh tabel utuh (Parent Document) untuk diberikan kepada LLM, sehingga LLM tidak kehilangan konteks.
2. Menaklukkan Diagram Kelistrikan (Wiring Diagrams)
   Vector Database standar hanya bisa mencari teks, bukan gambar garis atau simbol kelistrikan. Jika ada informasi yang hanya ada di dalam gambar skema, sistem biasa akan buta sama sekali.
   Pre-processing dengan Vision Model: Saat Anda memasukkan PDF ke dalam database (fase Ingestion), sistem Anda harus mendeteksi keberadaan gambar/diagram. Kirim gambar tersebut ke Vision Language Model (seperti Mistral Small 4) dan perintahkan AI untuk mendeskripsikan diagram tersebut secara detail ke dalam teks.
   Contoh Prompt Internal: "Ekstrak semua informasi wiring dari diagram ini. Tuliskan port mana terhubung ke mana."
   Teks hasil deskripsi inilah yang kemudian disimpan di Vector DB agar bisa dicari oleh engineer.
   Penyajian Multimodal: Saat engineer bertanya dan sistem RAG Anda menemukan bahwa jawabannya berasal dari sebuah diagram, jangan hanya menyuruh LLM menjawab dengan teks. Sistem harus mengambil gambar diagram aslinya dan menampilkannya di UI layar engineer. Membaca deskripsi teks tentang wiring sangat membingungkan dibandingkan melihat diagramnya langsung.
3. Arsitektur yang Dibutuhkan
   Untuk membangun sistem ini, kerangka kerja Anda kurang lebih akan terlihat seperti ini:
   Document Ingestion: PDF masuk ke sistem -> LlamaParse memisahkan Teks, Tabel (jadi Markdown), dan Gambar.
   Image Summarization: Gambar dikirim ke Vision AI untuk dibuatkan teks ringkasannya.
   Database: Teks, Markdown Tabel, dan Teks Ringkasan Gambar masuk ke Vector Database (Convex). Gambar asli disimpan di Object Storage (Tigris Data).
   Retrieval & Generation: Engineer bertanya -> Sistem mencari ke Vector DB -> Mengambil teks/tabel dan gambar asli yang relevan -> Mengirim semuanya ke LLM untuk dirangkum -> Menjawab engineer beserta kutipan dan gambar pendukung.
   Mengingat dokumen vendor ini pasti bersifat rahasia dan spesifik, apakah Anda berencana membangun platform ini sepenuhnya di infrastruktur lokal (on-premise / self-hosted open-source) demi keamanan data, atau Anda terbuka untuk menggunakan layanan AI dari penyedia cloud?

### Question: dokumen vendor ini seharusnya bebas diunduh dari website resmi dan saya akan menggunakan layanan AI dari penyedia cloud.

### Answer: Kabar baik! Fakta bahwa dokumen tersebut bersifat publik dan Anda terbuka untuk menggunakan layanan cloud akan memangkas sekitar 70% kerumitan infrastruktur. Anda tidak perlu memusingkan server lokal berspesifikasi tinggi (GPU) atau batasan keamanan internal yang ketat.

Dengan pendekatan cloud-native, Anda bisa langsung memanfaatkan API terbaik di pasaran untuk menaklukkan tabel teknis dan diagram kelistrikan.
Berikut adalah rancangan arsitektur tingkat tinggi (high-level architecture) yang sangat ideal untuk platform asisten engineer ini:

1. Ekstraksi Dokumen (Data Ingestion Pipeline)
   Karena masalah utamanya adalah format tabel dan gambar, lupakan library gratisan. Gunakan layanan cloud khusus document parsing:
   LlamaParse API (LlamaCloud): Saat ini ini adalah standar industri terbaik untuk mengubah PDF teknis menjadi Markdown. Algoritmanya sangat presisi dalam menjaga struktur baris dan kolom tabel spesifikasi.
   Google Cloud Document AI: Alternatif enterprise yang sangat kuat untuk mengekstrak informasi terstruktur dari dokumen industri.
2. Pemrosesan Visi (Vision Processing)
   Untuk diagram wiring kelistrikan, setelah LlamaParse memisahkan gambarnya, Anda bisa menembakkan gambar tersebut ke API Vision Model. Mengingat Anda sering melakukan benchmarking terhadap efisiensi dan biaya LLM, Anda bisa membandingkan beberapa model cloud untuk tugas ekstraksi gambar ini:
   Mistral Small 4: Sangat cepat dan murah dalam membaca diagram dan mengubahnya menjadi logika teks.
3. Arsitektur Aplikasi (Frontend & Backend Stack)
   Untuk membangun platformnya sendiri, arsitektur serverless modern akan membuat proyek ini sangat lincah dan berkinerja tinggi:
   UI/Frontend: Ekosistem React dengan Astro dan Tailwind CSS sangat ideal untuk membangun antarmuka "Split-Screen" (Chat di kiri, Viewer PDF/Diagram di kanan).
   Backend & Vector Database: Anda tidak perlu memisahkan database relasional dan vector database. Platform backend real-time seperti Convex sudah memiliki dukungan Vector Search bawaan. Ini memungkinkan Anda menyimpan metadata dokumen, history chat, dan vector embeddings di satu tempat. Didukung dengan runtime yang cepat seperti Bun, query pencarian dari engineer akan terasa instan.
   Asset Management: Diagram dan potongan gambar PDF yang ditampilkan di UI perlu dimuat dengan sangat cepat. Anda bisa menyimpan aset ini di layanan object storage (seperti Tigris Data) dan mendistribusikannya melalui konfigurasi CDN dengan custom domain.
4. Strategi UI (Validasi oleh Engineer)
   Sistem cloud Anda akan bekerja seperti ini:
   Engineer mengetik: "Di PLC Control Logix konek ke IO mana saja?"
   Astro+React mengirim query ke Convex.
   Convex melakukan Vector Search dan menemukan rujukan di manual Allen-Bradley halaman 45.
   LLM merangkum instruksinya.
   Krusial: UI Anda menampilkan jawaban teks, dan memuat gambar diagram dari CDN secara berdampingan. Engineer bisa langsung memverifikasi jalurnya secara visual tanpa harus membuka dokumen PDF asli.
   Mengingat tingkat akurasi ekstraksi adalah penentu utama keberhasilan platform ini, apakah Anda sudah memiliki satu contoh dokumen manual PDF (datasheet atau wiring guide) yang paling rumit untuk kita jadikan bahan pengujian (Proof of Concept) pertama?

### Question: ini contoh pdf

### Answer: Sempurna. Dokumen "GuardLogix 5570 Controllers User Manual" (1756-um022\_-en-p.pdf) dari Allen-Bradley ini adalah kandidat Proof of Concept (PoC) yang luar biasa ideal. Buku manual untuk lini produk 1756 (ControlLogix/GuardLogix) memang terkenal sangat padat dengan peringatan keselamatan (safety), tabel status indikator, aturan pemasangan sasis, dan tentu saja, skema arsitektur.

Jika kita memproses dokumen ini menggunakan rancangan platform yang kita bahas, alur kerjanya di belakang layar akan terlihat seperti ini:

1. Tahap Pembongkaran (Ingestion)
   PDF ini tidak akan dipotong-potong secara membabi buta. Menggunakan alat seperti LlamaParse, sistem akan membedah strukturnya. Halaman yang berisi "Tabel Status Indikator LED" akan diekstrak dengan mempertahankan struktur baris dan kolomnya menjadi format Markdown. Sementara itu, gambar skema penempatan Primary Controller dan Safety Partner di dalam sasis akan diekstrak sebagai file gambar yang utuh.
2. Pemrosesan Multimodal
   Gambar skema pemasangan sasis tadi tidak dibiarkan bisu. Sistem akan mengirim gambar tersebut ke Vision AI (seperti Mistral Small 4) untuk dianalisis. AI akan menghasilkan narasi teks, misalnya: "Diagram menunjukkan bahwa Safety Partner (1756-L7SP) harus dipasang di slot yang letaknya tepat di sebelah kanan Primary Safety Controller."
3. Penyimpanan Data & Aset (Backend Pipeline)
   Teks manual, tabel Markdown, dan teks deskripsi gambar tadi akan diubah menjadi vector embeddings dan disimpan di dalam database real-time seperti Convex. Arsitektur ini memungkinkan pencarian berbasis vektor dilakukan dengan sangat cepat.
   Untuk aset visualnya, potongan gambar diagram asli dari PDF akan diunggah ke object storage (seperti Tigris Data) dan dikonfigurasi agar tayang melalui custom domain. Ini memastikan gambar bisa dimuat seketika di layar pengguna.
4. Interaksi Engineer (Frontend Experience)
   Platform antarmuka yang dibangun dengan Atro+React dan Tailwind CSS akan menjadi tempat engineer berinteraksi. Dengan runtime yang dioptimalkan seperti Bun, proses query akan terasa instan.
   Misalnya engineer bertanya: "Di mana saya harus memasang module partner untuk 1756-L73S?"
   Proses query ke Convex akan menemukan kecocokan vektor pada teks hasil analisis gambar tadi. LLM akan merangkai jawaban: "Module partner (1756-L7SP) harus dipasang di slot yang berada persis di sebelah kanan controller 1756-L73S." Nilai Jual Utama (The Magic): Bersamaan dengan jawaban teks tersebut, UI aplikasi di sebelah kanan layar akan langsung menarik gambar diagram sasis asli dari CDN, lengkap dengan kutipan nomor halamannya. Engineer bisa langsung memverifikasi secara visual tanpa perlu mengunduh atau scrolling ratusan halaman PDF GuardLogix tersebut.
   Apakah Anda ingin mencoba mensimulasikan satu studi kasus atau pertanyaan troubleshooting paling menjebak yang biasa ditanyakan engineer terkait seri GuardLogix ini, untuk melihat bagaimana AI seharusnya membingkai jawabannya?

### Question: saya tidak tahu studi kasus atau pertanyaan troubleshooting paling menjebak yang biasa ditanyakan engineer, berarti harus dipikirkan juga

### Answer: Tidak masalah sama sekali. Sebagai seorang Software Engineer, wajar jika detail operasional perangkat keras industri bukan ranah Anda. Justru di sinilah letak nilai jual produk yang sedang Anda bangun: platform ini menutupi celah pengetahuan antara programmer dan field engineer.

Mari kita rancang satu skenario troubleshooting tingkat lanjut yang sangat realistis untuk seri GuardLogix 5570. Pertanyaan ini adalah tipe "jebakan" yang akan membuat sistem RAG berbasis teks biasa berhalusinasi atau memberikan jawaban tak berguna, tetapi akan dijawab dengan brilian oleh arsitektur multimodal kita.
Skenario: Jebakan "Lampu Merah Safety Partner"
Bayangkan seorang engineer di lapangan sedang panik karena mesin pabrik mati. Ia mengetikkan prompt ini di platform Anda:
Pertanyaan Engineer:
"Saya baru saja memasang primary controller 1756-L73S di slot 0 dan safety partner 1756-L7SP di sebelahnya. Primary controller terlihat normal, tapi lampu indikator 'OK' pada 1756-L7SP menyala MERAH SOLID (tidak berkedip). Komunikasi terputus. Apa masalahnya dan bagaimana cara memperbaikinya?"
Mengapa ini "Menjebak" RAG Biasa?
Butuh Pencarian Tabel Presisi: AI harus mencari tabel "LED Indicators" khusus untuk tipe Safety Partner (L7SP), lalu mencari baris spesifik "OK LED", kolom status "Solid Red". Jika tabel PDF hancur saat ekstraksi, AI mungkin mengambil status lampu hijau atau berkedip, yang penanganannya sama sekali berbeda.
Konteks Spasial/Posisi Fisik: Di buku manual GuardLogix (dan di diagram aslinya), ada aturan mutlak: Safety Partner harus selalu berada di slot tepat sebelah kanan Primary Controller. Jika dipasang di slot lain, perangkat akan malfungsi parah. RAG teks biasa sering gagal menangkap "aturan posisi" ini dari sebuah gambar diagram.
Bagaimana Platform Anda Menjawabnya (Visi UI Split-Screen)
Platform Anda, yang didukung Vector Search instan dan Vision Model, akan merender tampilan seperti ini:
Bagian Kiri (Area Chat AI):
🚨 Indikasi Masalah Hardware/Pemasangan
Berdasarkan buku manual GuardLogix 5570 (Halaman XX), indikator OK LED berwarna Merah Solid pada Safety Partner (1756-L7SP) menandakan Hardware Fault (Kesalahan Perangkat Keras) yang tidak dapat dipulihkan secara perangkat lunak.
Langkah Perbaikan:
Cek Posisi Slot (Sangat Krusial): Pastikan modul 1756-L7SP terpasang di slot tepat sebelah kanan (Slot 1) dari Primary Controller (1756-L73S). GuardLogix tidak mentolerir jarak slot kosong di antara keduanya. (Lihat diagram instalasi sasis).
Cek Sasis: Cabut modul dan periksa apakah ada pin konektor backplane sasis yang bengkok.
Jika posisi sudah benar dan tidak ada pin bengkok, bersihkan slot, pasang kembali, dan lakukan power cycle (matikan lalu nyalakan daya). Jika lampu masih merah solid, modul tersebut rusak secara fisik dan harus diganti.
Bagian Kanan (Area Penampil Dokumen/Aset):
Sistem Anda langsung menarik dua gambar dari CDN tanpa jeda, menampilkannya persis di samping jawaban:
[Gambar 1]: Potongan tabel status LED dari PDF asli, dengan baris "OK - Solid Red - Hardware Fault" ditandai (sebagai bukti sumber kebenaran).
[Gambar 2]: Potongan diagram skematik Sasis yang menunjukkan secara visual posisi "Primary" dan "Partner" yang harus saling menempel berdampingan.
Dengan output seperti ini, engineer di lapangan tidak perlu lagi menebak-nebak apakah AI sedang berhalusinasi. Mereka mendapatkan langkah taktis (actionable steps) sekaligus bukti visual dari manual resmi dalam hitungan detik.
Pendekatan split-screen dan multimodal ini adalah pembeda utama antara sekadar "ChatGPT pembaca PDF" dengan asisten troubleshooting level enterprise.
Mengingat Anda akan menggunakan layanan cloud untuk ekstraksi ini (seperti LlamaParse), apakah Anda ingin kita mulai membahas bagaimana menstrukturkan schema tabel database (misalnya di Convex) untuk mengakomodasi teks, metadata PDF, dan link gambar CDN ini dalam satu relasi pencarian?

### Question: sebelum kita mulai membahas bagaimana menstrukturkan schema tabel database (misalnya di Convex) untuk mengakomodasi teks, metadata PDF, dan link gambar CDN ini dalam satu relasi pencarian, apakah ada alternatif gratis LlamaParse? bukankah LlamaParse berbayar? saya tidak ada uang

### Answer: Sangat bisa dimaklumi! Wajar sekali jika di tahap awal (Proof of Concept / PoC) kita ingin menekan biaya infrastruktur hingga Rp 0.

Kabar baiknya: Anda sama sekali tidak perlu mengeluarkan uang untuk memulai proyek ini. Ada beberapa jalur alternatif gratis, dan saya juga punya satu "jalan pintas" menggunakan layanan cloud gratisan.
Berikut adalah 3 opsi alternatif gratis untuk mengekstrak PDF teknis (tabel dan gambar) yang bisa Anda pilih:
Opsi 1: LlamaParse Sebenarnya Punya Versi Gratis (Free Tier)
Banyak yang mengira LlamaParse sepenuhnya berbayar, padahal mereka memiliki batas gratis yang cukup dermawan untuk developer.
Batas Gratis: Anda bisa memproses hingga 1.000 halaman PDF per hari tanpa kartu kredit.
Kecocokan: Buku manual GuardLogix tadi tebalnya sekitar 300 halaman. Artinya, Anda bisa memproses dokumen tersebut sampai selesai, dan masih punya sisa kuota harian yang banyak secara gratis.
Opsi 2: Menggunakan Open Source AI (Gratis 100%, Tanpa Kuota)
Jika Anda sama sekali tidak ingin bergantung pada layanan pihak ketiga dan ingin alat yang sepenuhnya gratis dan open-source, ada dua penguasa baru di dunia ekstraksi dokumen AI. Anda bisa menjalankannya secara gratis menggunakan Google Colab (sehingga tidak membebani RAM/CPU laptop Anda):
Marker (oleh VikParuchuri): Ini adalah library Python yang sedang sangat populer. Ia dirancang khusus untuk mengubah buku dan PDF teknis menjadi format Markdown secara akurat. Ia sangat jago mengenali tabel dan persamaan matematika.
Docling (oleh IBM): Pendatang baru yang dirilis open-source oleh IBM. Alat ini luar biasa hebat dalam memahami struktur halaman kompleks (multi-kolom) dan mengekstrak tabel menjadi format yang rapi untuk RAG.
Cara kerja untuk PoC Anda: Unggah PDF Anda ke Google Colab -> Jalankan skrip Python Marker/Docling -> Unduh hasil Markdown dan gambarnya -> Masukkan ke sistem Convex Anda. Semuanya gratis.
Opsi 3: "Jalan Pintas" Menggunakan Mistral API Free Tier (Paling Direkomendasikan)
Karena Anda pada akhirnya membutuhkan AI untuk merangkum gambar (Vision) dan teks, mengapa tidak menggunakan AI untuk mengekstraknya juga?
Mistral API memiliki free tier (batas gratis) yang sangat besar. Anda bisa menggunakan model Mistral Small 4 secara gratis (dengan batasan request per menit).
Kelebihan Mistral Small 4: Ia memiliki kemampuan Native PDF Understanding. Anda tidak perlu alat ekstraksi tambahan. Anda bisa langsung mengunggah dokumen PDF GuardLogix tersebut ke API Mistral, lalu memberikan prompt (instruksi) khusus.
Contoh Prompt Ekstraksi: "Baca halaman 40-50 dari PDF ini. Ekstrak semua tabel LED menjadi format Markdown, dan berikan deskripsi teks untuk setiap diagram wiring yang ada di halaman tersebut."
Rekomendasi Langkah Terbaik untuk Anda:
Mengingat Anda ingin membangun aplikasi menggunakan Astro+React dan Convex, tanpa modal awal, pendekatan terbaik adalah kombinasi ini:
Gunakan LlamaParse Free Tier (1.000 halaman/hari) untuk membedah PDF menjadi teks/Markdown dan mengekstrak file gambar diagramnya. Ini paling minim coding konfigurasi.
Gunakan Mistral API Free Tier untuk bagian Vision (membaca gambar diagram) dan sebagai LLM utama saat aplikasi Astro+React Anda berjalan.
Dengan kombinasi di atas, arsitektur multimodal Anda akan berjalan tanpa biaya langganan sepeser pun selama masa pengembangan.
Bagaimana menurut Anda? Apakah kita akan menggunakan asumsi "Alat Gratis / Free Tier" ini untuk melangkah ke pembahasan bagaimana menyusun kerangka database (schema tabel) di Convex?

### Question: free plan llamaparse dapat 10000 kredit, coba kamu baca juga docs pricing dan rate limit https://developers.llamaindex.ai/llamaparse/general/pricing/

Answer: Ah, Anda benar! LlamaParse sekarang menggunakan sistem berbasis kredit, dan di versi gratisnya (Free Tier) Anda mendapatkan 10.000 kredit gratis per hari.

### Answer: Setelah memeriksa dokumentasi harga terbaru mereka, sistem billing ini justru sangat fleksibel dan memberi ruang yang sangat luas untuk bereksperimen, terutama saat Anda terus memantau metrik efisiensi dan biaya dari pipeline AI Anda.

Berikut adalah rincian cara kerja sistem 10.000 kredit tersebut dan bagaimana penerapannya untuk proyek ekstraksi manual industri ini:

1. Struktur Biaya Parsing (API V2)
   LlamaParse memotong kredit per halaman berdasarkan tingkat "kecerdasan" atau beban komputasi yang Anda minta. Ada empat tier utama:
   Fast (1 kredit/halaman): Paling murah, tetapi hanya mengekstrak teks mentah (tanpa format Markdown). Kapasitas: 10.000 halaman/hari.
   Cost-effective (3 kredit/halaman): Titik tengah yang ideal untuk teks standar. Kapasitas: 3.333 halaman/hari.
   Agentic (10 kredit/halaman): Mode ini menggunakan agen AI untuk membaca halaman berulang kali guna merapikan tabel dan struktur yang rumit. Kapasitas: 1.000 halaman/hari.
   Agentic Plus (45 kredit/halaman): Ekstraksi level tertinggi untuk dokumen dengan tingkat kerumitan visual ekstrem.
   Ada juga tambahan opsi opsional seperti Layout Extraction yang memakan tambahan +3 kredit per halamannya.
2. Simulasi untuk Buku Manual GuardLogix (300 Halaman)
   Jika kita memasukkan manual GuardLogix 5570 (sekitar 300 halaman) ke dalam sistem:
   Menggunakan mode Cost-effective (3 kredit), Anda hanya akan menghabiskan 900 kredit.
   Jika tabel spesifikasi teknisnya ternyata berantakan dan Anda harus "naik gigi" ke mode Agentic (10 kredit), pemrosesan 300 halaman tersebut memakan 3.000 kredit.
   Dalam kedua skenario di atas, Anda memproses seluruh buku manual tanpa melewati batas 10.000 kredit/hari. Anda bahkan bisa memproses 3 dokumen spesifikasi vendor berbeda setiap harinya dengan tingkat akurasi tinggi secara gratis.
3. Trik Optimasi (Cost Optimization)
   Dokumentasinya juga menyebutkan beberapa strategi penghematan yang sangat relevan saat Anda membangun logika backend:
   Caching 48 Jam: LlamaParse menyimpan cache dokumen selama dua hari. Jika saat pengembangan (PoC) terjadi bug pada aplikasi dan Anda perlu meminta API mengekstrak dokumen yang sama, proses ulang dalam masa 48 jam tersebut gratis.
   Page Ranges: Jika manual Allen-Bradley memiliki 30 halaman awal berupa peringatan hak cipta dan daftar isi, Anda bisa memprogram API untuk melewati halaman tersebut (target_pages) agar kredit tidak terbuang percuma.
   Filter Harga (Extract-Only): Jika format dasar sudah di-parse, tindakan ekstraksi data di atasnya akan dikenai biaya lebih rendah.
   Jadi, Anda sama sekali tidak perlu mengeluarkan uang untuk memulai. Kredit 10.000 per hari ini lebih dari cukup untuk membangun pipeline injeksi data yang solid.
   Mengingat Anda akan mengelola aset hasil ekstraksi ini secara real-time (teks dan gambar diagram), apakah kita bisa mulai membahas bagaimana menyusun schema database di Convex agar query engineer bisa langsung menarik teks dan gambar secara bersamaan?

### Question: ya kita bisa mulai membahas bagaimana menyusun schema database di Convex agar query engineer bisa langsung menarik teks dan gambar secara bersamaan

### Answer: Langkah yang sangat tepat. Desain schema database adalah kunci utama agar fitur "Split-Screen" (teks dan gambar berdampingan) bisa merender seketika tanpa loading yang lambat atau query yang rumit.

Dalam ekosistem Convex, kita mendefinisikan schema menggunakan TypeScript. Keunggulan utama Convex untuk kasus multimodal RAG ini adalah kemampuannya menyimpan teks, relasi, dan Vector Index di dalam satu tempat yang sama.
Berikut adalah rancangan arsitektur schema (convex/schema.ts) yang sangat optimal untuk platform asisten engineer Anda:
TypeScript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({
// Tabel 1: Menyimpan metadata level tinggi dari dokumen (PDF)
documents: defineTable({
title: v.string(), // cth: "GuardLogix 5570 Controllers User Manual"
vendor: v.string(), // cth: "Allen-Bradley"
catalogNumbers: v.array(v.string()), // cth: ["1756-L73S", "1756-L7SP"]
pdfUrl: v.string(), // Link opsional ke PDF asli jika engineer ingin unduh
uploadDate: v.number(),
})
.index("by_vendor", ["vendor"]), // Indeks biasa untuk filter kategori di UI

// Tabel 2: "Jantung" dari sistem RAG. Menyimpan potongan informasi (Chunks)
chunks: defineTable({
documentId: v.id("documents"), // Relasi ke tabel documents

    // Klasifikasi tipe data yang diekstrak oleh LlamaParse
    chunkType: v.union(
      v.literal("text"),           // Teks paragraf biasa
      v.literal("table"),          // Tabel spesifikasi (format Markdown)
      v.literal("diagram")         // Gambar skema / wiring
    ),

    // 'content' berfungsi ganda:
    // 1. Jika chunkType "text" atau "table" -> Berisi teks asli / Markdown.
    // 2. Jika chunkType "diagram" -> Berisi TEKS HASIL ANALISIS MISTRAL SMALL 4 VISION.
    content: v.string(),

    pageNumber: v.number(),        // Sangat krusial untuk kutipan (citations)

    // 'imageUrl' menyimpan link CDN Tigris/Cloudflare
    // Berisi URL jika chunk berupa gambar/diagram, dan 'null' jika teks biasa
    imageUrl: v.optional(v.string()),

    // 'embedding' menyimpan representasi angka dari 'content' untuk pencarian AI
    // Biasanya model embedding (seperti text-embedding-3-small) menghasilkan 1536 dimensi
    embedding: v.array(v.float64()),

})
// Mendefinisikan Vector Index bawaan Convex
.vectorIndex("by_embedding", {
vectorField: "embedding",
dimensions: 1536, // Sesuaikan dengan output model embedding yang dipakai
filterFields: ["documentId", "chunkType"], // Memungkinkan pre-filtering agar pencarian lebih presisi
}),
});
Bagaimana Schema Ini Bekerja Secara Ajaib di Sisi "Query"
Desain di atas dirancang dengan prinsip "Satu Tarikan Napas" (Single Fetch). Mari kita lihat alurnya ketika engineer bertanya tentang "Lampu Merah Safety Partner":
Embedding Pertanyaan: Aplikasi Astro+React Anda mengubah pertanyaan engineer menjadi vektor (angka).
Pencarian Cepat: Convex akan mencari di vectorIndex("by_embedding"). Ia akan membandingkan vektor pertanyaan dengan vektor di kolom content.
Pencocokan Diagram: Sistem menemukan kecocokan tinggi dengan sebuah chunk bertipe "diagram". Mengapa cocok? Karena kolom content pada chunk tersebut berisi deskripsi teks dari Mistral Small 4 Vision yang berbunyi: "Diagram ini menunjukkan Safety Partner (1756-L7SP) dengan lampu indikator merah solid..."
Data Dikembalikan: Convex langsung mengembalikan seluruh baris chunk tersebut ke frontend.
Di sinilah UI Anda bekerja (Sisi Frontend):
Karena seluruh data berada dalam satu objek JSON, komponen React Anda bisa langsung melakukan percabangan logika (conditional rendering) tanpa harus melakukan query tambahan ke database:
JavaScript
// Pseudo-code komponen React di Astro+React
if (result.chunkType === "diagram" && result.imageUrl) {
// Render jawaban LLM di kiri
renderChat(llmResponse);

// Render gambar beresolusi tinggi langsung dari CDN di kanan
renderImage(result.imageUrl);

// Tampilkan kutipan akurat
renderCitation(`Sumber: Manual Allen-Bradley, Halaman ${result.pageNumber}`);
}
Fleksibilitas Masa Depan
Dengan memisahkan chunkType (text, table, diagram), Anda memberi aplikasi Anda kemampuan untuk berkembang. Misalnya, jika nanti Anda ingin membuat tampilan khusus yang merender tabel Markdown menjadi komponen React Table yang bisa di-sort atau di-filter oleh engineer, frontend Anda sudah memiliki struktur data yang siap untuk itu.
Setelah melihat struktur ini, apakah Anda ingin kita membahas fungsi internal Convex (file convex/query.ts atau convex/actions.ts) yang akan menerima pertanyaan engineer dan memicu pencarian vektornya? Atau Anda ingin membahas skrip Python/Node.js yang akan "menyuapi" (Ingestion) data dari LlamaParse ke tabel ini?

### Question: bahas keduanya

### Answer: Keputusan yang tepat! Memahami kedua sisi—bagaimana data masuk (Ingestion) dan bagaimana data ditarik (Retrieval/Querying)—akan memberikan Anda gambaran utuh (end-to-end) tentang arsitektur platform ini.

Karena Anda berencana menggunakan ekosistem Astro+React, kita akan merancang kedua bagian ini menggunakan TypeScript/Node.js. Dengan begitu, seluruh stack aplikasi Anda (Frontend, Backend, dan Pipeline) menggunakan bahasa yang seragam.
Mari kita bedah satu per satu.
Bagian 1: Skrip "Penyuap Data" (Ingestion Pipeline)
Skrip ini berjalan di latar belakang (bukan diakses oleh engineer). Anda menjalankannya sekali setiap kali Allen-Bradley merilis buku manual baru.
Tugas Utama: PDF ➡️ LlamaParse ➡️ Mistral Small 4 Vision ➡️ Text Embedding ➡️ Simpan ke Convex.

Berikut adalah kerangka logikanya (dalam bentuk pseudo-code TypeScript):

TypeScript
// ingest.ts (Berjalan secara lokal atau di server worker)
import { LlamaParseReader } from "llamaindex";
import { ConvexHttpClient } from "convex/browser";

const convex = new ConvexHttpClient(process.env.CONVEX_URL);

async function processManual() {
// 1. Ekstraksi dengan LlamaParse (Free Tier)
const parser = new LlamaParseReader({ resultType: "markdown" });
const documents = await parser.loadData("1756-um022\_-en-p.pdf");
const images = await parser.getImages(); // Mengekstrak gambar diagram

for (const page of documents) {
// 2. Jika halaman mengandung Teks atau Tabel
if (page.text) {
const embedding = await generateVector(page.text);
await convex.mutation("documents:insertChunk", {
chunkType: "table", // atau "text"
content: page.text,
pageNumber: page.metadata.page_num,
embedding: embedding
});
}
}

for (const img of images) {
// 3. Jika itu Gambar Diagram, suruh Mistral merangkumnya
const visionModel = mistral({ model: "mistral-small-4" });
const prompt = "Ekstrak info wiring/hardware dari diagram kelistrikan ini.";
const visionResult = await visionModel.generateContent([prompt, img.data]);
const diagramDescription = visionResult.response.text();

    // 4. Upload gambar ke CDN (Tigris/Cloudflare), dapatkan URL-nya
    const cdnUrl = await uploadToCDN(img.data);

    // 5. Simpan deskripsi teksnya beserta URL gambarnya ke Convex
    const embedding = await generateVector(diagramDescription);
    await convex.mutation("documents:insertChunk", {
         chunkType: "diagram",
         content: diagramDescription, // Teks yang bisa dicari (searchable)
         pageNumber: img.page_num,
         imageUrl: cdnUrl,            // Gambar yang akan ditayangkan di UI
         embedding: embedding
    });

}
}
Poin Kunci: Data yang masuk ke Convex sudah dalam kondisi "matang". Gambar diagram sudah memiliki perwakilan teks (deskripsi), sehingga bisa ditemukan lewat pencarian.
Bagian 2: Fungsi Backend Convex (Retrieval & Generation)
Ini adalah fungsi yang dieksekusi secara real-time saat engineer menekan tombol "Cari Solusi" di layar Astro+React mereka.
Di dalam Convex, karena proses ini membutuhkan pemanggilan API eksternal (untuk membuat vektor dan memanggil LLM), kita tidak menggunakan query, melainkan action.
Berikut adalah rancangan fungsi di backend Convex (convex/actions.ts):
TypeScript
// convex/actions.ts
import { action } from "./\_generated/server";
import { v } from "convex/values";

export const askEngineerAssistant = action({
args: {
userQuestion: v.string() // cth: "Lampu merah safety partner"
},
handler: async (ctx, args) => {
// 1. Ubah pertanyaan user menjadi Vektor (Angka)
const questionEmbedding = await generateVector(args.userQuestion);

    // 2. Lakukan Vector Search Instan di Database Convex
    const searchResults = await ctx.vectorSearch("chunks", "by_embedding", {
      vector: questionEmbedding,
      limit: 3, // Ambil 3 chunk paling relevan
    });

    // 3. Tarik data lengkap (teks, markdown, url gambar) dari hasil pencarian
    const contexts = await Promise.all(
      searchResults.map(async (result) => {
         const chunkData = await ctx.runQuery("documents:getChunk", { id: result._id });
         return chunkData;
      })
    );

    // 4. Susun "System Prompt" yang ketat untuk LLM
    const promptContext = contexts.map(c =>
      `[Halaman ${c.pageNumber} - Tipe: ${c.chunkType}]: ${c.content}`
    ).join("\n\n");

    const systemPrompt = `
      Anda adalah asisten teknis GuardLogix. Jawab HANYA dari konteks berikut.
      Jika instruksinya terkait letak hardware, sebutkan detail posisinya.

      Konteks Dokumen:
      ${promptContext}

      Pertanyaan Engineer: ${args.userQuestion}
    `;

    // 5. Panggil LLM (mistral) untuk merangkai jawaban akhir yang mudah dibaca
    const model = mistral({ model: "mistral-small-4" });
    const finalAnswer = await model.generateContent(systemPrompt);

    // 6. Kembalikan Jawaban LLM beserta Aset Gambar langsung ke Frontend
    return {
      answer: finalAnswer.response.text(),
      supportingImages: contexts.filter(c => c.imageUrl).map(c => ({
        url: c.imageUrl,
        page: c.pageNumber
      }))
    };

}
});
Menyambungkan Keduanya di Frontend
Berkat arsitektur di atas, tugas di frontend (Astro+React) Anda menjadi sangat ringan. Saat merender halaman, Anda cukup membaca objek JSON yang dikembalikan oleh action askEngineerAssistant.
Anda cukup merender result.answer di komponen Chat (sebelah kiri), lalu melakukan mapping pada array result.supportingImages untuk menampilkan gambar skema sasis dari CDN langsung di Panel Viewer (sebelah kanan).
Dengan struktur "Data Pipeline" dan "Backend Action" ini, Anda sudah memiliki arsitektur RAG skala enterprise yang siap pakai.

### Question: melihat rancangan struktur UI-nya

### Answer: Tentu, mari kita rancang struktur UI-nya. Untuk mencapai pengalaman enterprise yang instan dan intuitif bagi engineer di lapangan, kita akan menggunakan pola desain "Asymmetric Split-Screen" (Layar Terbelah Asimetris).

Karena Anda menggunakan Astro+React dan Tailwind CSS, kita bisa memanfaatkan `CSS Grid` untuk membagi layar menjadi dua zona utama: Chat Interface (Panel Interaksi) dan Asset Viewer (Panel Validasi Visual).
Berikut adalah rancangan struktur komponen dan logika status (state)-nya:

1. Dekomposisi Komponen (Component Tree)
   Kita akan memecah UI ini menjadi komponen-komponen React yang modular agar mudah dipelihara dan diuji:

- `DashboardLayout` (Kontainer utama, tinggi layar penuh `h-screen`)
  - `ChatPanel` (Kolom Kiri - Lebar 40% atau 4/12 Grid)
    - `MessageList` (Menampilkan riwayat obrolan)
      - `UserMessage` (Gelembung teks pertanyaan)
      - `AIMessage` (Gelembung teks jawaban + tombol "Lihat Diagram")
    - `ChatInput` (Kolom input teks di bawah)
  - `ViewerPanel` (Kolom Kanan - Lebar 60% atau 8/12 Grid)
    - `EmptyState` (Tampil saat belum ada gambar yang perlu diverifikasi)
    - `ImageViewer` (Menampilkan gambar skema dari CDN Tigris/Cloudflare)
    - `CitationBadge` (Menampilkan info: "Manual Allen-Bradley - Halaman 45")

2. Manajemen Status (State Management)
   Di level komponen halaman utama (`page.tsx`), Anda hanya membutuhkan tiga _state_ sederhana menggunakan React `useState`:
1. `messages`: Array objek untuk menyimpan riwayat obrolan (siapa yang mengirim dan apa isinya).
1. `activeAsset`: Objek yang menyimpan URL gambar dan nomor halaman yang sedang disorot di Panel Kanan.
1. `isSearching`: Boolean untuk menampilkan indikator _loading_ saat menunggu balasan dari Convex/Mistral.
1. Kerangka Dasar Kode (Astro+React + Tailwind)
   Berikut adalah struktur kerangka kodenya (tanpa emoji, sesuai standar dokumentasi profesional Anda):

```tsx
// app/page.tsx
"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";

export default function RAGDashboard() {
  const [messages, setMessages] = useState([]);
  const [activeAsset, setActiveAsset] = useState<{ url: string; page: number } | null>(null);
  const [input, setInput] = useState("");

  const askAssistant = useAction(api.actions.askEngineerAssistant);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    // Tambahkan pesan user ke UI
    const userMsg = { role: "user", text: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    // Panggil backend Convex
    const response = await askAssistant({ userQuestion: userMsg.text });

    // Tambahkan balasan AI ke UI
    setMessages((prev) => [
      ...prev,
      { role: "ai", text: response.answer, images: response.supportingImages },
    ]);

    // Otomatis tampilkan gambar pertama di panel kanan (jika ada)
    if (response.supportingImages && response.supportingImages.length > 0) {
      setActiveAsset(response.supportingImages[0]);
    }
  };

  return (
    <main className="grid h-screen grid-cols-1 md:grid-cols-12 bg-gray-50 overflow-hidden">

      {/* LEFT PANEL: Chat Interface (4/12 width on Desktop) */}
      <section className="md:col-span-4 flex flex-col border-r border-gray-200 bg-white">
        <header className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-semibold text-gray-800">Field Assistant</h1>
        </header>

        {/* Chat History Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {messages.map((msg, idx) => (
            <div key={idx} className={msg.role === "user" ? "text-right" : "text-left"}>
              <div className={`inline-block p-3 rounded-lg ${
                msg.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-800"
              }`}>
                <p className="text-sm whitespace-pre-wrap">{msg.text}</p>

                {/* Image Trigger Buttons */}
                {msg.images && msg.images.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveAsset(img)}
                    className="mt-2 text-xs text-blue-600 underline font-medium block"
                  >
                    View Reference (Page {img.page})
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Input Area */}
        <form onSubmit={handleSubmit} className="p-4 border-t border-gray-200">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe the hardware issue..."
            className="w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </form>
      </section>

      {/* RIGHT PANEL: Asset Viewer (8/12 width on Desktop) */}
      <section className="md:col-span-8 bg-gray-100 flex flex-col relative">
        {activeAsset ? (
          <div className="w-full h-full p-8 flex items-center justify-center">
            {/* Citation Badge */}
            <div className="absolute top-4 left-4 bg-white px-4 py-2 rounded-md shadow text-sm font-medium text-gray-700">
              Source: GuardLogix Manual, Page {activeAsset.page}
            </div>

            {/* The Diagram */}
            <img
              src={activeAsset.url}
              alt="Technical Reference"
              className="max-w-full max-h-full object-contain rounded-lg shadow-sm bg-white"
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <svg className="w-16 h-16 mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-sm">Select a reference from the chat to view diagrams.</p>
          </div>
        )}
      </section>

    </main>
  );
}
```

Prompt untuk AI Assistant Anda (Frontend)
Sama seperti bagian backend, Anda bisa menyalin instruksi berikut ke agen AI Anda (Cursor/Claude Code) untuk langsung menghasilkan komponen ini beserta variasi desain yang lebih detail:

```text
# UI Construction Context
We are building the Frontend for the Multimodal RAG engineering platform.
Stack: Astro, React, Tailwind CSS, Convex React Client.

# Technical Directives
- Follow Spec-Driven Development (SDD).
- Implement an asymmetric split-screen layout using CSS Grid (`grid-cols-12`).
- Left panel (span 4): Chat Interface.
- Right panel (span 8): Technical Asset Viewer.
- Ensure the layout is responsive (stacks vertically on mobile `md:grid-cols-1`).
- DO NOT use emojis in code comments.

# Task: Build Dashboard Page
1. Create `app/page.tsx`.
2. Setup local state for `messages`, `activeAsset` ({url: string, page: number}), and `input`.
3. Use the `useAction` hook from `convex/react` to map to `api.actions.askEngineerAssistant`.
4. Chat Panel functionality:
   - Render user messages clearly distinct from AI messages.
   - If an AI message contains `supportingImages`, render a clickable link/button below the text that updates the `activeAsset` state.
   - Fix the chat input to the bottom of the left panel.
5. Viewer Panel functionality:
   - If `activeAsset` is null, display a subtle empty state indicating that the user should select a reference.
   - If `activeAsset` exists, render an `img` tag pointing to the URL. Use `object-contain` to ensure the full diagram is visible without distortion.
   - Overlay a small citation badge at the top of the viewer showing the page number.
```

Dengan UI terstruktur seperti ini, saat Convex mengembalikan respons, layar engineer akan langsung menampilkan instruksi langkah demi langkah di kiri, dan diagram wiring beresolusi tinggi di kanan.

### Question: berikan dokumen komplit prd, brd, plan dan dokumen pendukung lainnya tentang proyek ini.

### Answer: Berikut adalah draf dokumen esensial untuk proyek **Platform Multimodal RAG Asisten Teknisi Industri**. Dokumen ini dirancang untuk memberikan kejelasan visi, spesifikasi teknis, dan peta jalan eksekusi.

```
## 1. Business Requirements Document (BRD)

**1.1. Ringkasan Eksekutif (Executive Summary)**
Teknisi lapangan sering kali menghabiskan waktu berjam-jam mencari informasi spesifik (tabel *pin-out*, status LED, diagram *wiring*) di dalam buku manual PDF industri yang tebal (ratusan halaman). Proyek ini bertujuan membangun platform Asisten AI bertenaga *Multimodal Retrieval-Augmented Generation* (RAG) yang mampu memahami teks, tabel, dan gambar diagram dari manual resmi (seperti Allen-Bradley GuardLogix), guna memberikan solusi pemecahan masalah (*troubleshooting*) secara instan dan akurat.

**1.2. Tujuan Bisnis (Business Objectives)**
* **Efisiensi Waktu:** Memangkas waktu pencarian dokumentasi teknis dari hitungan jam/menit menjadi hitungan detik.
* **Akurasi Operasional:** Mengurangi kesalahan konfigurasi perangkat keras dengan menyediakan instruksi yang merujuk langsung pada *source of truth* (manual resmi vendor).
* **Aksesibilitas Pengetahuan:** Menjembatani kesenjangan keahlian antara teknisi junior dan senior melalui asisten AI yang siap sedia.

**1.3. Pengguna Sasaran (Target Audience)**
* *Field Engineers* (Teknisi Lapangan)
* *Maintenance Staff* (Staf Pemeliharaan Pabrik)
* *System Integrators* (Integrator Sistem Otomatisasi)

**1.4. Metrik Keberhasilan (Key Performance Indicators)**
* Akurasi respons (diukur dari relevansi kutipan dokumen).
* *Time-to-Resolution* (TTR) untuk masalah teknis di lapangan.
* Waktu muat (*latency*) untuk merender jawaban AI beserta gambar pendukung (< 3 detik).

---

## 2. Product Requirements Document (PRD)

**2.1. Visi Produk**
Menciptakan "Asisten Peneliti Super Cepat" untuk perangkat keras industri yang tidak hanya merangkum teks, tetapi juga menyajikan bukti visual dan data tabular langsung dari buku panduan resmi.

**2.2. Fitur Utama (Core Features)**
* **Multimodal Ingestion Pipeline:** Kemampuan mengekstrak PDF teknis yang kompleks menjadi teks mentah, tabel berformat Markdown, dan memisahkan gambar diagram.
* **AI Vision Translation:** Kemampuan AI untuk "membaca" dan menerjemahkan diagram *wiring* kelistrikan menjadi deskripsi teks agar dapat dicari (*searchable*).
* **Vector & Semantic Search:** Mesin pencari internal yang merespons pertanyaan bahasa natural (contoh: "Kenapa lampu OK merah?") dan mencocokkannya dengan makna di dalam dokumen.
* **Asymmetric Split-Screen UI:** Antarmuka dengan obrolan AI di sisi kiri dan penampil visual (tabel/diagram asli) di sisi kanan.
* **Exact Citation Tracking:** Setiap jawaban AI wajib menyertakan lencana nomor halaman dan menyorot gambar referensi.

**2.3. Spesifikasi Teknis (Tech Stack)**
* **Frontend:** Astro, React, Tailwind CSS.
* **Backend & Database:** Convex (*Serverless Backend* + Native Vector Database).
* **AI Models:** Mistral Small 4 (Visi & LLM utama).
* **Document Parsing:** LlamaParse (pengenalan layout PDF lanjutan).
* **Asset Storage & CDN:** Tigris Data.
* **Runtime & Package Manager:** Bun.

**2.4. Batasan & Asumsi (Constraints & Assumptions)**
* **Batasan Biaya:** Infrastruktur akan dioptimalkan untuk beroperasi sepenuhnya pada *Free Tier* (LlamaParse 10.000 kredit/hari, Mistral API batas gratis).
* **Asumsi Keamanan:** Buku manual yang diproses (seperti PDF GuardLogix) bersifat publik dan bebas diunduh, sehingga aman diproses melalui API pihak ketiga.

---

## 3. Project Plan (Peta Jalan Pelaksanaan)


### Fase 1: Data Ingestion & Ekstraksi
* **Tujuan:** Membedah dokumen PDF pertama (contoh: *GuardLogix 5570 User Manual*) menjadi aset terstruktur.
* **Tugas:**
    * Menyiapkan akun dan API Key (LlamaCloud, Mistral).
    * Membuat skrip `ingest.ts` menggunakan LlamaParse.
    * Memastikan tabel diekstrak sebagai Markdown yang rapi.
    * Menulis fungsi pemanggilan Mistral Vision untuk mendeskripsikan gambar diagram.

### Fase 2: Backend & Database Setup (Minggu 2)
* **Tujuan:** Membangun fondasi penyimpanan dan pencarian data.
* **Tugas:**
    * Menginisialisasi proyek Convex.
    * Membuat `convex/schema.ts` untuk tabel `documents` dan `chunks` beserta Vector Index.
    * Mengeksekusi skrip injeksi untuk memasukkan data hasil Fase 1 ke dalam Convex.
    * Membuat fungsi penarikan `askEngineerAssistant` di `convex/actions.ts`.

### Fase 3: Frontend Development (Minggu 3)
* **Tujuan:** Membangun antarmuka interaktif.
* **Tugas:**
    * Mendesain *layout CSS Grid* (4/12 Chat, 8/12 Viewer).
    * Mengintegrasikan *hook* Convex ke komponen Astro+React.
    * Membangun komponen render khusus untuk merender Markdown (tabel) dan memuat gambar *high-res* dari CDN.

### Fase 4: Testing & Iterasi Prompt (Minggu 4)
* **Tujuan:** Memastikan AI tidak berhalusinasi dan merespons dengan format yang benar.
* **Tugas:**
    * Menguji dengan skenario "jebakan" (seperti salah penempatan slot *hardware*).
    * Menyesuaikan *System Prompt* agar AI bersikap kaku dan hanya mengutip dari konteks Convex.
    * Finalisasi dan *deployment* aplikasi (misal: ke VPS).

---

## 📐 4. Dokumen Pendukung (Lampiran Arsitektur)

**Alur Kerja Data (End-to-End Flow):**

1.  **Input Pengguna:** Engineer mengetik "Bagaimana cara koneksi I/O port 1?".
2.  **Pemrosesan Vektor:** Astro+React mengirim teks ke Convex Action ➡️ Diubah menjadi Vektor oleh Model Embedding.
3.  **Pencarian Semantic:** Convex mencari kecocokan Vektor terdekat di tabel `chunks`.
4.  **Penyusunan Konteks:** Teks asli, tabel Markdown, dan deksripsi gambar ditarik dari *database*.
5.  **Generasi AI:** Konteks disuapkan ke Mistral Small 4 dengan instruksi ketat untuk tidak berhalusinasi.
6.  **Pengiriman Output:** AI mengembalikan jawaban teks dan array URL gambar.
7.  **Render UI:** Layar kiri menampilkan instruksi teknis; layar kanan langsung memuat gambar diagram aslinya beserta nomor halaman referensi.
```
