// This plugin will open a window to prompt the user to enter a number, and
// it will then create that many rectangles on the screen.

// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

// This shows the HTML page in "ui.html".
figma.showUI(__html__);

// Calls to "parent.postMessage" from within the HTML page will trigger this
// callback. The callback will be passed the "pluginMessage" property of the
// posted message.
console.log("--- code.ts 実行開始 ---");

// GeoJSONのFeatureCollectionの型を定義
interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

// GeoJSONのFeatureの型を定義
interface GeoJsonFeature {
  type: "Feature";
  geometry: {
    type: "Polygon";
    coordinates: number[][][]; // [[[x1, y1], [x2, y2], ...]]
  };
  properties: {
    name: string;
    category: string;
    floor: number;
    figmaNodeName: string;
  };
}

figma.ui.onmessage = (msg: { type: string, count: number }) => {
  if (msg.type === "conv") {
  const selection = figma.currentPage.selection;
  // 1. フレームが1つだけ選択されているかチェック
  if (selection.length !== 1 || selection[0].type !== 'FRAME') {
    figma.closePlugin('フレームを1つだけ選択してください。');
  } else {
    const selectedFrame = selection[0];
    console.log(`フレーム「${selectedFrame.name}」を処理中...`);

    const geoJson: GeoJsonFeatureCollection = {
      type: "FeatureCollection",
      features: [],
    };

    // 2. フレーム内のすべての子要素を検索
    // 'VECTOR' 型のノード（ベクターオブジェクト）だけをフィルタリング
    const vectorNodes = selectedFrame.findAll(node => node.type === 'VECTOR') as VectorNode[];

    if (vectorNodes.length === 0) {
      figma.closePlugin('選択されたフレーム内にベクターオブジェクトが見つかりませんでした。');
    } else {
      // 3. 各ベクターオブジェクトを処理
      vectorNodes.forEach(vector => {
        // 4. レイヤー名からプロパティを解析
        const nameParts = vector.name.split(',').map(part => part.trim());
        if (nameParts.length !== 3) {
          console.warn(`レイヤー名「${vector.name}」の形式が正しくありません。スキップします。 (形式: 施設名,カテゴリ,階数)`);
          return; // forEachの次のループへ
        }

        const [facilityName, category, floorStr] = nameParts;
        const floor = parseInt(floorStr, 10);

        // 階数が数値でない場合はスキップ
        if (isNaN(floor)) {
          console.warn(`レイヤー名「${vector.name}」の階数が数値ではありません。スキップします。`);
          return;
        }

        // 5. 頂点座標を取得してGeoJSON形式に変換
        const vertices = vector.vectorNetwork.vertices;
        const coordinates = vertices.map(v => [v.x, v.y]);
        // ポリゴンを閉じるために始点を末尾に追加
        if (coordinates.length > 0) {
          coordinates.push(coordinates[0]);
        }

        // 6. GeoJSONのFeatureオブジェクトを作成
        const feature: GeoJsonFeature = {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [coordinates], // GeoJSONのPolygonは三重配列
          },
          properties: {
            name: facilityName,
            category: category,
            floor: floor,
            figmaNodeName: vector.name, // デバッグ用に元のレイヤー名も保持
          },
        };

        geoJson.features.push(feature);
      });

      // 7. 最終的なGeoJSONをコンソールに出力
      if (geoJson.features.length > 0) {
        console.log('--- GeoJSON出力 ---');
        // JSON.stringifyの第3引数でインデントを付け、見やすくする
        console.log(JSON.stringify(geoJson, null, 2));
        figma.closePlugin('GeoJSONをコンソールに出力しました。');
      } else {
        figma.closePlugin('処理できる形式のベクターオブジェクトがありませんでした。');
      }
    }

    // Make sure to close the plugin when you're done. Otherwise the plugin will
    // keep running, which shows the cancel button at the bottom of the screen.
    figma.closePlugin();
  };
  }
};