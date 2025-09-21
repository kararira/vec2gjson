// --- code.ts ---

// (interface定義は変更なし)
interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}
interface GeoJsonFeature {
  type: "Feature";
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
  properties: {
    name: string;
    category: string;
    floor: number;
    figmaNodeName: string;
  };
}

// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
// ★ 基準点(0,0)としたいオブジェクトのレイヤー名を指定 ★
// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
const ORIGIN_OBJECT_NAME = "background-image";


// UIを表示し、サイズを指定する
figma.showUI(__html__, { width: 280, height: 120 });

// -----------------------------------------------------------------
// メインの処理
// -----------------------------------------------------------------
const selection = figma.currentPage.selection;

if (selection.length !== 1 || selection[0].type !== 'FRAME') {
  figma.ui.postMessage({ type: 'error', message: 'フレームを1つだけ選択してください。' });
} else {
  const selectedFrame = selection[0];
  const frame_height = selectedFrame.height;

  const geoJson: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };

  const vectorNodes = selectedFrame.findAll(node => node.type === 'VECTOR') as VectorNode[];

  if (vectorNodes.length === 0) {
    figma.ui.postMessage({ type: 'error', message: '選択されたフレーム内にベクターオブジェクトが見つかりませんでした。' });
  } else {
    vectorNodes.forEach(vector => {
      const nameParts = vector.name.split(',').map(part => part.trim());
      if (nameParts.length !== 3) { return; }

      const [facilityName, category, floorStr] = nameParts;
      const floor = parseInt(floorStr, 10);
      if (isNaN(floor)) { return; }

      const vertices = vector.vectorNetwork.vertices;

      // ★変更点3: 各頂点の座標を基準オブジェクトからの相対座標に変換
      const coordinates = vertices.map(v => {
        // 頂点の絶対座標 = ベクター自体の座標 + ベクター内の頂点座標
        const absoluteX = vector.x + v.x;
        const absoluteY = vector.y + v.y;
        // 絶対座標から基準オブジェクトの座標を引く
        return [ absoluteX, frame_height - absoluteY];
      });

      if (coordinates.length > 0) {
        coordinates.push(coordinates[0]);
      }

      const feature: GeoJsonFeature = {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [coordinates],
        },
        properties: {
          name: facilityName,
          category: category,
          floor: floor,
          figmaNodeName: vector.name,
        },
      };
      geoJson.features.push(feature);
    });

    // ★変更点4: UIへのメッセージ送信ロジックを整理
    if (geoJson.features.length > 0) {
      figma.ui.postMessage({
        type: 'export-geojson',
        data: JSON.stringify(geoJson, null, 2),
        filename: `${selectedFrame.name}.geojson`
      });
    } else {
      figma.ui.postMessage({ type: 'error', message: '処理できる形式のベクターオブジェクトがありませんでした。' });
    }
  }
}