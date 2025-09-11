// --- code.ts ---

// (interface定義などは変更なし)
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

// ★変更点: UIを表示し、サイズを指定する
figma.showUI(__html__, { width: 280, height: 120 });

// -----------------------------------------------------------------
// メインの処理
// -----------------------------------------------------------------
const selection = figma.currentPage.selection;

if (selection.length !== 1 || selection[0].type !== 'FRAME') {
  // ★変更点: UIにエラーメッセージを送信してプラグインを閉じる
  figma.ui.postMessage({ type: 'error', message: 'フレームを1つだけ選択してください。' });
} else {
  const selectedFrame = selection[0];
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
      if (nameParts.length !== 3) {
        // console.warnは残しても良い
        return;
      }
      
      const [facilityName, category, floorStr] = nameParts;
      const floor = parseInt(floorStr, 10);

      if (isNaN(floor)) {
        return;
      }

      const vertices = vector.vectorNetwork.vertices;
      const coordinates = vertices.map(v => [v.x, v.y]);
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

    if(geoJson.features.length > 0) {
      console.log('--- GeoJSON出力 ---');
      // JSON.stringifyの第3引数でインデントを付け、見やすくする
      console.log(JSON.stringify(geoJson, null, 2));
    } else {
      console.log("GeoJsonないみたい");
    }
    
    if(geoJson.features.length > 0) {
      // ★変更点: 生成したGeoJSONをUIに送信する
      figma.ui.postMessage({ 
        type: 'export-geojson', 
        data: JSON.stringify(geoJson, null, 2),
        filename: `${selectedFrame.name}.geojson` // ファイル名をフレーム名にする
      });
    } else {
      figma.ui.postMessage({ type: 'error', message: '処理できる形式のベクターオブジェクトがありませんでした。' });
    }
  }
}