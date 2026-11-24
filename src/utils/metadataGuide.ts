import type { MetadataTagItem } from './metadataUtils';

export interface MetadataFieldGuide {
  purpose: string;
  riskLevel: 'high' | 'medium' | 'low';
  risk: string;
  inputKind: 'text' | 'number' | 'datetime' | 'orientation' | 'multiline' | 'readonly-physical';
}

export function getMetadataFieldGuide(tag: MetadataTagItem, lang: 'ja' | 'en'): MetadataFieldGuide {
  const ja = lang === 'ja';
  const id = tag.id;
  const key = tag.key;
  const keyLower = key.toLowerCase();

  // ---- File Level Metadata ----
  if (id === 'file_name') {
    return {
      purpose: ja
        ? 'OSやブラウザ上でファイルを識別するための名前本体（拡張子を除く部分）を設定しています。'
        : 'Defines the base filename used by the OS and applications to identify the file.',
      riskLevel: 'low',
      risk: ja
        ? 'ファイル内容自体は変わりませんが、Webサイト・スクリプト・他文書からこのファイル名でリンク・参照されている場合にリンク切れを起こすことがあります。'
        : 'File bytes remain unchanged, though external scripts or document links referencing the old filename may break.',
      inputKind: 'text',
    };
  }

  if (id === 'file_ext') {
    return {
      purpose: ja
        ? 'ファイル名末尾に付く「名前上の拡張子」を設定しています。OSやアプリがどのソフトウェアで開くかを判断する目印です。'
        : 'Sets the filename extension label that tells the OS and apps which software should open the file.',
      riskLevel: 'high',
      risk: ja
        ? '実データ（バイナリ署名）と一致しない拡張子へ変更すると、ダブルクリックで開けなくなったり破損ファイル扱いされるリスクがあります。'
        : 'Changing this to mismatch the actual binary format can prevent double-click opening or cause apps to report a corrupted file.',
      inputKind: 'text',
    };
  }

  if (id === 'file_size') {
    return {
      purpose: ja
        ? 'ファイル実体（バイナリデータ）の正確な物理バイト数を表示しています。'
        : 'Reports the exact physical byte length of the file binary payload.',
      riskLevel: 'high',
      risk: ja
        ? 'ファイルサイズは実データ長そのものであり、メタデータのみを独立して書き換えることは仕様上できません（他のメタデータを編集・削除すると再計算されます）。'
        : 'File size is derived directly from binary length and cannot be edited independently; modifying or stripping other metadata recalculates it.',
      inputKind: 'readonly-physical',
    };
  }

  if (id === 'file_mtime') {
    return {
      purpose: ja
        ? 'OSやZIPアーカイブ上で認識されるファイルの最終更新日時（File.lastModified タイムスタンプ）を設定しています。'
        : 'Configures the filesystem / ZIP archive last-modified timestamp (File.lastModified).',
      riskLevel: 'low',
      risk: ja
        ? 'ファイルの内容は変わりませんが、証跡監査・バージョン管理・バックアップの差分比較・時系列ソート基準が変化します（ブラウザ仕様によりDL保存時は現在時刻で上書きされる場合があります）。'
        : 'May alter audit trails, backup diff detection, or chronological sorting. Some browsers overwrite OS timestamps on download (preserved inside ZIP).',
      inputKind: 'datetime',
    };
  }

  // ---- BMP / ICO / PPM Structural Headers & Comments ----
  if (id.startsWith('ppm_comment_')) {
    return {
      purpose: ja
        ? 'PPM（Netpbm）ヘッダ内に埋め込まれた「#」コメント行です。作成ソフト名、パラメータ、撮影メモなどが記述されます。'
        : 'Comment line (#) embedded inside the PPM/Netpbm header, often containing generator hints or notes.',
      riskLevel: 'low',
      risk: ja
        ? '画像のピクセルデータには影響しません。環境名や作成者メモが含まれている場合は編集・削除できます。'
        : 'Does not affect pixel raster data. Safe to edit or strip when removing software/author hints.',
      inputKind: 'text',
    };
  }

  if (id.startsWith('bmp_') || id.startsWith('ico_') || id.startsWith('ppm_')) {
    return {
      purpose: ja
        ? 'BMP / ICO / PPM（Netpbm P3/P6）画像の構造ヘッダ情報（解像度、色深度・格納アイコンフレーム一覧、P3/P6形式識別子など）です。'
        : 'Structural raster header property (dimensions, bit depth, ICO frame directory, or Netpbm P3/P6 format header).',
      riskLevel: 'high',
      risk: ja
        ? '画素データと密接に結びついた物理ヘッダ値のため直接の文字書き換えはできません。形式・解像度の変更は「画像編集・変換」タブをご利用ください。'
        : 'Physical raster header bound directly to pixel layout; use the Image Editor / Batch Converter tab to change dimensions or format.',
      inputKind: 'readonly-physical',
    };
  }

  // ---- C2PA Content Credentials ----
  if (tag.group === 'C2PA' || id.startsWith('c2pa_') || id === 'xmp_c2pa_provenance' || keyLower.includes('digitalsourcetype') || keyLower.includes('provenance')) {
    return {
      purpose: ja
        ? 'C2PA（Content Credentials）およびAI生成・撮影来歴の署名付きマニフェスト（JUMBF / CBOR / XMP来歴）を記録しています。作成ツール、編集履歴、電子署名証明書を含みます。'
        : 'Stores C2PA Content Credentials / provenance data including generator tool, edit actions, digital source type, and cryptographic signature.',
      riskLevel: 'high',
      risk: ja
        ? 'この領域を変更・一部編集・削除すると、内蔵されている暗号署名（COSE署名）とハッシュ整合性が即座に無効になり、来歴検証ツールで「改ざん・署名無効（Invalid）」と判定されます。プライバシー目的で消去する場合は完全削除を推奨します。'
        : 'Any edit invalidates the cryptographic COSE signature and hash binding, causing provenance verifiers to flag tampering or invalid credentials.',
      inputKind: tag.group === 'C2PA' ? 'multiline' : 'text',
    };
  }

  // ---- GPS / Location ----
  if (tag.group === 'GPS' || id.startsWith('gps_') || id === 'xmp_gps' || id.startsWith('mp4_xyz_')) {
    if (key === 'GPSVersionID') {
      return {
        purpose: ja
          ? 'EXIF GPS IFDのデータ規格バージョン（通常 2, 3, 0, 0）を識別するためのヘッダ情報です。'
          : 'Identifies the EXIF GPS IFD specification version (typically 2, 3, 0, 0).',
        riskLevel: 'low',
        risk: ja
          ? '不正なバージョン番号へ変更すると、一部カメラソフトや地図ビューアがGPS座標を正しく読み込めなくなる場合があります。'
          : 'Invalid version bytes may prevent some viewers from parsing GPS tags correctly.',
        inputKind: 'text',
      };
    }
    if (key === 'GPSLatitudeRef' || key === 'GPSLongitudeRef') {
      return {
        purpose: ja
          ? '緯度（N=北緯 / S=南緯）または経度（E=東経 / W=西経）の半球方角を設定しています。'
          : 'Sets the hemisphere reference (N/S for latitude, E/W for longitude).',
        riskLevel: 'medium',
        risk: ja
          ? 'N/SやE/Wを誤ると地球の反対側など全く別の位置を指すようになります。座標変更やプライバシー保護のため削除することも可能です。'
          : 'Wrong hemisphere letters flip the location to the opposite side of the globe. Remove or adjust carefully.',
        inputKind: 'text',
      };
    }
    if (key === 'GPSAltitudeRef') {
      return {
        purpose: ja
          ? '標高の基準面（0=海抜以上、1=海面下）を設定しています。'
          : 'Defines whether altitude is above sea level (0) or below sea level (1).',
        riskLevel: 'low',
        risk: ja
          ? '誤った値にすると標高がマイナス表記になるなどの表示誤差が生じます。'
          : 'Incorrect value flips altitude above/below sea level.',
        inputKind: 'number',
      };
    }
    if (key === 'GPSTimeStamp' || key === 'GPSDateStamp') {
      return {
        purpose: ja
          ? 'GPS衛星の原子時計から取得した測位日時（UTC基準の日付または時:分:秒）を記録しています。'
          : 'Records the UTC date or time acquired from GPS satellite atomic clocks.',
        riskLevel: 'medium',
        risk: ja
          ? '撮影日時のフォレンジック照合やタイムゾーン推定に影響します。撮影時刻を完全に隠したい場合は他のEXIF日時と合わせて編集・削除してください。'
          : 'Affects chronological forensics and timezone inference. Edit or remove alongside EXIF timestamps for privacy.',
        inputKind: 'text',
      };
    }
    return {
      purpose: ja
        ? '撮影場所や作成場所の正確な緯度・経度・標高・測位情報（プライバシーに直結する位置情報）を設定しています。'
        : 'Stores precise geographic coordinates (latitude, longitude, altitude) revealing where the media was captured.',
      riskLevel: 'high',
      risk: ja
        ? '自宅や訪問先などの機密な居場所情報が第三者に特定されるリスクがある反面、変更・削除すると地図アルバム連携、現地撮影証明、位置ベース検索が機能しなくなります。'
        : 'Sharing exposes physical location; removing or altering it breaks map albums and location verification.',
      inputKind: 'text',
    };
  }

  // ---- EXIF Tags ----
  if (tag.group === 'EXIF') {
    if (key === 'Orientation') {
      return {
        purpose: ja
          ? '画像の回転・上下反転の表示方向（1=通常、3=180°、6=右90°、8=左90°など EXIF Orientation フラグ）を設定しています。'
          : 'Controls display rotation/mirroring orientation (1=Normal, 3=180°, 6=90° CW, 8=90° CCW).',
        riskLevel: 'high',
        risk: ja
          ? '実際のピクセル配列と合わない数値に変更すると、画像ビューアやブラウザ上で写真が横向きや逆さまに表示されます。'
          : 'Setting a value that conflicts with pixel orientation causes viewers to render the image sideways or upside down.',
        inputKind: 'orientation',
      };
    }
    if (key === 'ColorSpace') {
      return {
        purpose: ja
          ? '画像の標準色空間（1=sRGB、65535=Uncalibrated/AdobeRGB等）をビューアに伝えるタグです。'
          : 'Indicates the image color space (1=sRGB, 65535=Uncalibrated / custom ICC).',
        riskLevel: 'medium',
        risk: ja
          ? '変更すると色再現（彩度やコントラスト）が環境によって変化したり、カラーマネジメント対応ソフトで色味が崩れる場合があります。'
          : 'Altering may shift color reproduction or brightness in color-managed viewers.',
        inputKind: 'number',
      };
    }
    if (key === 'XResolution' || key === 'YResolution' || key === 'ResolutionUnit') {
      return {
        purpose: ja
          ? '印刷時やDTPレイアウト時に参照される解像度密度（DPI / ピクセル毎インチ・cm）の設定です。'
          : 'Defines intended print pixel density (DPI / pixels per unit) used by DTP and printers.',
        riskLevel: 'low',
        risk: ja
          ? 'Web表示のピクセル数は変わりませんが、Word/PDF/印刷ソフトへ貼り付けた際の初期印刷サイズが変わる可能性があります。'
          : 'Screen pixel dimensions do not change, though physical print scale in DTP software may alter.',
        inputKind: 'text',
      };
    }
    if (key === 'PixelXDimension' || key === 'PixelYDimension') {
      return {
        purpose: ja
          ? 'EXIF内に記録された論理ピクセル幅・高さのメタ情報です。'
          : 'Records logical pixel width/height metadata stored in the EXIF block.',
        riskLevel: 'medium',
        risk: ja
          ? '実画像の幅・高さと異なる値に書き換えると、一部サムネイル生成や解析ツールが縦横比や解像度を誤認することがあります。'
          : 'Mismatching actual image dimensions can confuse thumbnailers or asset inspectors.',
        inputKind: 'number',
      };
    }
    if (key === 'Make' || key === 'Model' || key === 'LensMake' || key === 'LensModel' || key === 'LensSpecification') {
      return {
        purpose: ja
          ? '撮影に使用したカメラ機種メーカー・モデル名・レンズ仕様（端末指紋情報）を設定しています。'
          : 'Identifies the camera manufacturer, device model, and lens hardware used to capture the image.',
      riskLevel: 'medium',
      risk: ja
        ? '所有端末の特定につながる一方、編集・削除するとフォトアプリの機材別フィルタやレンズ収差自動補正・RAW現像プロファイル適用ができなくなります。'
        : 'Reveals hardware fingerprint; deleting or altering disables lens correction profiles and camera-based library filters.',
      inputKind: 'text',
    };
    }
    if (key === 'BodySerialNumber' || key === 'LensSerialNumber' || key === 'CameraOwnerName') {
      return {
        purpose: ja
          ? 'カメラ本体やレンズ固有のシリアル番号、または登録されている所有者名（個人特定リスクが高い識別子）を設定しています。'
          : 'Contains unique camera/lens serial numbers or registered owner name.',
      riskLevel: 'medium',
      risk: ja
        ? 'オンライン公開時に撮影機材や所有者が一意に追跡されるリスクがあります。消去しても画質には影響しませんが、機材盗難時の所有証明や写真コンテストの原本証明要件には影響します。'
        : 'Enables exact device/owner tracking across uploads. Safe to delete for privacy, though contests or proof-of-ownership checks may fail.',
      inputKind: 'text',
    };
    }
    if (key === 'DateTimeOriginal' || key === 'DateTimeDigitized' || key === 'DateTime (ModifyDate)' || key.startsWith('OffsetTime')) {
      return {
        purpose: ja
          ? '撮影時刻・デジタル化時刻・最終更新時刻およびタイムゾーン時差（例: +09:00）を記録しています。'
          : 'Records shutter capture timestamp, digitization time, modification time, or UTC timezone offset.',
      riskLevel: 'medium',
      risk: ja
        ? 'フォトライブラリの時系列並び替え基準が変わります。公的証拠・契約書・SNSの投稿検証など日時証明が必要な画像では原本性が損なわれます。'
        : 'Changes chronological sorting in photo libraries and compromises evidentiary timestamp authenticity.',
      inputKind: 'text',
    };
    }
    if (key === 'ExposureTime' || key === 'FNumber' || key === 'ISOSpeedRatings' || key === 'FocalLength') {
      return {
        purpose: ja
          ? 'シャッター速度・絞り値(F値)・ISO感度・焦点距離などのカメラ露出パラメータを記録しています。'
          : 'Records camera exposure telemetry (shutter speed, aperture, ISO, focal length).',
      riskLevel: 'low',
      risk: ja
        ? '画像自体への影響はありませんが、写真学習データ・ストックフォト審査・撮影設定参照の正確性が失われます。'
        : 'No visual impact, but breaks exposure telemetry used in stock photo review or photography analysis.',
      inputKind: 'text',
    };
    }
    if (key === 'Artist (Author)' || key === 'Copyright' || key === 'Software' || key === 'ImageDescription' || key === 'UserComment' || key === 'JPEG Comment (COM)' || key === 'Photoshop / IPTC (APP13)') {
      return {
        purpose: ja
          ? '作成者名、著作権表示、使用ソフトウェア、画像説明・コメント、またはPhotoshop/IPTCプレス用メタデータを格納しています。'
          : 'Stores author attribution, copyright notice, editing software, descriptions, or IPTC/Photoshop metadata.',
      riskLevel: 'medium',
      risk: ja
        ? '個人名・企業名・社内環境名が外部へ漏洩する原因になる一方、著作権表記や権利情報（IPTC）を削除すると帰属主張やストック素材のライセンス確認が困難になります。'
        : 'May leak personal/software details, whereas removing copyright/IPTC strips attribution and licensing rights info.',
      inputKind: key === 'Photoshop / IPTC (APP13)' || key === 'JPEG Comment (COM)' || key === 'UserComment' ? 'multiline' : 'text',
    };
    }
    return {
      purpose: ja
        ? 'JPEG / TIFF / PNG / WebP のEXIFコンテナ内に格納されている拡張タグ・ベンダー固有データです。'
        : 'Extended or vendor-specific EXIF tag stored inside the image metadata directory.',
      riskLevel: 'low',
      risk: ja
        ? '特殊な形式（整数配列や分数型など）を不正な書式へ変更すると値が0になったり、一部ソフトがEXIF解析を中断する場合があります。'
        : 'Entering malformed values for numeric/rational tags may reset the tag or affect strict EXIF parsers.',
      inputKind: 'text',
    };
  }

  // ---- PNG Tags ----
  if (tag.group === 'PNG') {
    if (key.startsWith('tIME')) {
      return {
        purpose: ja
          ? 'PNGファイルの最終更新時刻（UTC、tIMEチャンク）をバイナリ形式で記録しています。'
          : 'Records the last modification timestamp (UTC) in the PNG tIME chunk.',
        riskLevel: 'low',
        risk: ja
          ? '更新日時の履歴やPNG出力時刻の手がかりが変わります。書式が不正だと現在時刻へフォールバックされます。'
          : 'Alters embedded PNG modification date. Malformed formats fall back cleanly or reset.',
        inputKind: 'text',
      };
    }
    return {
      purpose: ja
        ? 'PNGテキストチャンク（tEXt / iTXt / zTXt）に格納されたコメント、作成ツール、AI生成プロンプト（parameters等）、権利情報です。'
        : 'PNG text chunk (tEXt/iTXt/zTXt) holding comments, software hints, AI generation parameters, or copyright strings.',
      riskLevel: 'medium',
      risk: ja
        ? '画像生成AIのプロンプト・シード値や個人名が含まれている場合があり、再配布時の情報漏洩に繋がります。逆にワークフロー情報として必要な場合は書き換え・削除に注意してください。'
        : 'Often contains AI prompts, seeds, or author names. Editing/deleting alters workflow metadata embedded in the PNG.',
      inputKind: 'multiline',
    };
  }

  // ---- PDF Tags ----
  if (tag.group === 'PDF') {
    if (key === 'Producer' || key === 'Creator') {
      return {
        purpose: ja
          ? 'PDFを作成した元アプリ（Creator: Word, Illustrator等）およびPDF変換エンジン（Producer: Acrobat, Chrome等）を記録しています。'
          : 'Identifies the authoring application (Creator) and PDF conversion library/engine (Producer).',
        riskLevel: 'low',
        risk: ja
          ? '社内利用ソフトやOS環境・バージョン構成が推測される要因になります。変更してもPDFの表示レイアウト自体は変わりません。'
          : 'May reveal software stack or OS environment; changing does not alter rendered PDF pages.',
        inputKind: 'text',
      };
    }
    if (key === 'CreationDate' || key === 'ModDate') {
      return {
        purpose: ja
          ? 'PDFドキュメント情報辞書に記録された作成日時・更新日時です。'
          : 'Records the document creation or modification date inside the PDF Info dictionary.',
        riskLevel: 'medium',
        risk: ja
          ? '契約書や申請書の提出時・文書管理システムでの更新履歴整合性に影響します。不正な日付文字列を入力すると削除または無効日付として扱われます。'
          : 'Affects document audit timelines and archive indexing. Invalid date strings cannot be parsed as PDF dates.',
        inputKind: 'text',
      };
    }
    return {
      purpose: ja
        ? 'PDFのタイトル・作成者・サブタイトル・キーワード・カスタムInfoプロパティを設定しています。検索エンジンや閲覧ソフトのタイトルバーに表示されます。'
        : 'Sets PDF document title, author, subject, keywords, or custom Info dictionary entries shown in readers and search indexes.',
      riskLevel: 'low',
      risk: ja
        ? '作成者名にPCユーザー名や本名が残ることがあります。変更・削除すると検索性やPDF閲覧時のウィンドウタイトル表示が変わります。'
        : 'May contain local PC usernames; modifying changes search indexing and viewer title display.',
      inputKind: 'text',
    };
  }

  // ---- Office Tags ----
  if (tag.group === 'Office') {
    if (key === 'Creator (Author)' || key === 'Last Modified By' || key === 'Company' || key === 'Manager') {
      return {
        purpose: ja
          ? 'Word / Excel / PowerPoint文書の作成者、最終更新者、所属会社名、管理者名（docProps/core.xml・app.xml）を設定しています。'
          : 'Stores Office document author, last editor, company, or manager inside docProps XML.',
      riskLevel: 'medium',
      risk: ja
        ? '社外へそのまま送付すると担当者名・取引先・組織構成が露出するプライバシー上のリスクがあります。一方で社内決裁・稟議の最終更新者確認には使用されます。'
        : 'Sharing externally may expose employee/company names; removing may affect internal approval tracking.',
      inputKind: 'text',
    };
    }
    if (key.startsWith('dcterms:')) {
      return {
        purpose: ja
          ? 'Office文書内部に記録されているISO形式の作成日時（created）および更新日時（modified）です。'
          : 'ISO-8601 embedded creation or modification timestamp in Office docProps/core.xml.',
      riskLevel: 'medium',
      risk: ja
        ? '変更・削除するとOffice上でのプロパティ日時やバージョン履歴の並び順が変わります。'
        : 'Modifies document creation/update timestamps displayed in Office Properties.',
      inputKind: 'text',
    };
    }
    return {
      purpose: ja
        ? 'Office文書のプロパティ（タイトル・件名・キーワード・説明・使用アプリ・カスタムプロパティ）を設定しています。'
        : 'Configures Office document properties (title, subject, keywords, description, or custom properties).',
      riskLevel: 'low',
      risk: ja
        ? '外部共有時のファイル検索・要約表示や、企業の自動分類・DLP（情報漏洩対策）ルール判定に影響を与える場合があります。'
        : 'May affect SharePoint/DLP metadata rules, indexing, and document summaries.',
      inputKind: 'text',
    };
  }

  // ---- XMP Tags ----
  if (tag.group === 'XMP') {
    return {
      purpose: ja
        ? 'Adobe XMP標準XMLパケットに埋め込まれた編集履歴、ツール情報、著作権、メタデータ日時またはPDF Catalog Metadataストリームです。'
        : 'Embedded Adobe XMP XML metadata packet containing editing software, dates, creator, or rights tags.',
      riskLevel: 'medium',
      risk: ja
        ? 'EXIF/PDF基本情報とは別にアプリ固有の編集履歴が残っている箇所です。XMP構文を壊す特殊なXML文字列を入れると一部ソフトでXMP全体が読み込めなくなるおそれがあります（編集時は自動エスケープされます）。'
        : 'App-specific XMP history often persists separately from EXIF/Info. Edited values are XML-escaped automatically.',
      inputKind: id === 'pdf_xmp_stream' ? 'multiline' : 'text',
    };
  }

  // ---- ISO-BMFF (MP4 / MOV / M4A) ----
  if (tag.group === 'ISO-BMFF') {
    return {
      purpose: ja
        ? 'MP4 / MOV / M4Aコンテナのヘッダ（mvhd日時）やメディア情報アトム（©nam / ©ART等のメタデータ）を設定しています。'
        : 'Configures MP4/MOV/M4A container header timestamps (mvhd) or iTunes/QuickTime media atoms.',
      riskLevel: 'medium',
      risk: ja
        ? 'バイナリのオフセットテーブル（stco）を壊さないよう安全に書き換えますが、極端に長い文字列へ変更した場合は収まる長さに自動調整される点と、動画管理ソフトでの撮影日順ソートに影響する点に注意してください。'
        : 'Written safely in-place to protect media chunk offsets (stco/co64); text exceeding box capacity may be truncated to fit.',
      inputKind: 'text',
    };
  }

  // ---- HTML / SVG / XML ----
  return {
    purpose: ja
      ? 'HTML / SVG / XML文書内のタイトル要素または <meta> タグに設定された作成者・説明・検索キーワード情報です。'
      : 'HTML/SVG/XML document <title> or <meta> tag configuring author, description, or SEO keywords.',
    riskLevel: 'low',
    risk: ja
      ? '検索エンジン（SEO）・SNSシェアカード（OGP）のプレビュー表示や、HTMLソース上の作成者表記に直接影響します。'
      : 'Directly alters SEO indexing, browser tab titles, and social share previews.',
    inputKind: 'text',
  };
}
