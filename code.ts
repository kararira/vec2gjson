// -----------------------------------------------------------------
// 1. GeoJSON 型定義
// -----------------------------------------------------------------

interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

/**
 * GeoJSONのGeometry型定義
 * Polygon, Point, LineString に対応
 */
type GeoJsonGeometry = {
  type: "Polygon";
  coordinates: number[][][];
} | {
  type: "Point";
  coordinates: number[];
} | {
  type: "LineString"; // 階段の線に対応
  coordinates: number[][];
};

interface GeoJsonFeature {
  type: "Feature";
  geometry: GeoJsonGeometry;
  properties: {
    [key: string]: any;
  };
}

// -----------------------------------------------------------------
// 2. ベクターパス追跡関数
// -----------------------------------------------------------------

/**
 * 1つの閉じたループのみで構成されていることを前提に、セグメントから頂点の描画順を再構築します。
 * @param segments ベクター全体のセグメントリスト
 * @returns 描画順に並んだ頂点のインデックスの配列
 */
function traceSingleLoop(segments: readonly VectorSegment[]): number[] {
  if (!segments || segments.length === 0) {
    return [];
  }

  // 作業用にセグメントのリストをコピー
  const remainingSegments = [...segments];
  const firstSegment = remainingSegments.shift()!;
  
  // 順序付けされた頂点インデックスのリストを初期化
  const orderedIndices: number[] = [firstSegment.start, firstSegment.end];
  let currentVertexIndex = firstSegment.end;

  // すべてのセグメントを使い切るまでループ
  while (remainingSegments.length > 0) {
    let foundNext = false;
    for (let i = 0; i < remainingSegments.length; i++) {
      const nextSegment = remainingSegments[i];
      let nextVertexIndex: number | null = null;
      
      if (nextSegment.start === currentVertexIndex) {
        nextVertexIndex = nextSegment.end;
      } else if (nextSegment.end === currentVertexIndex) {
        nextVertexIndex = nextSegment.start;
      }

      if (nextVertexIndex !== null) {
        orderedIndices.push(nextVertexIndex);
        currentVertexIndex = nextVertexIndex;
        remainingSegments.splice(i, 1); // 使用済みのセグメントを削除
        foundNext = true;
        break; // 内側のforループを抜ける
      }
    }
    if (!foundNext) {
      // 次に繋がるセグメントが見つからなかった場合
      break; 
    }
  }

  // 始点と終点が同じになっているはずなので、最後の要素を削除して重複を防ぐ
  if (orderedIndices[0] === orderedIndices[orderedIndices.length - 1]) {
    orderedIndices.pop();
  }

  return orderedIndices;
}

// -----------------------------------------------------------------
// 3. 1フレーム -> GeoJSONフィーチャリスト変換関数
// -----------------------------------------------------------------

const generate_feature_list_from_one_frame = (one_frame: FrameNode): GeoJsonFeature[] => {
  const feature_list: GeoJsonFeature[] = [];
  const frame_height = one_frame.height; // Y座標反転用の基準高さ
  const targetNodes = one_frame.children;

  if (targetNodes.length === 0) {
    // このフレーム内に子オブジェクトがない場合はスキップ
    return [];
  }

  targetNodes.forEach(targetNode => {
    const facilityId = targetNode.name;

    // -----------------
    // VECTOR (ポリゴン)
    // -----------------
    if (targetNode.type === "VECTOR") {
      const orderedVertexIndices = traceSingleLoop(targetNode.vectorNetwork.segments);
      if (orderedVertexIndices.length < 3) return; // 3頂点未満はポリゴンにできない

      const orderedVertices = orderedVertexIndices.map(index => targetNode.vectorNetwork.vertices[index]);
      
      const coordinates = [orderedVertices.map(v => {
        const absoluteX = targetNode.x + v.x;
        const absoluteY = targetNode.y + v.y;
        return [ absoluteX, frame_height - absoluteY]; // Y座標を反転
      })];

      // ポリゴンを閉じる
      if (coordinates.length > 0 && coordinates[0].length > 0) {
        coordinates[0].push(coordinates[0][0]);
      }

      // 内部の穴（ドーナツポリゴン）の処理
      if (targetNode.vectorNetwork.regions !== undefined && targetNode.vectorNetwork.regions.length > 0) {
        targetNode.vectorNetwork.regions[0].loops.slice(1).forEach((loop) => {
          const now_segments: VectorSegment[] = loop.map(segment_index => targetNode.vectorNetwork.segments[segment_index]);
          const innerOrderedVertexIndices = traceSingleLoop(now_segments);
          if (innerOrderedVertexIndices.length < 3) return;
          
          const innerOrderedVertices = innerOrderedVertexIndices.map(index => targetNode.vectorNetwork.vertices[index]);
          const innerCoordinates = innerOrderedVertices.map(v => {
            const absoluteX = targetNode.x + v.x;
            const absoluteY = targetNode.y + v.y;
            return [ absoluteX, frame_height - absoluteY];
          });
          
          if (innerCoordinates.length > 0) {
            innerCoordinates.push(innerCoordinates[0]); // 穴も閉じる
          }
          coordinates.push(innerCoordinates);
        });
      }

      const feature: GeoJsonFeature = {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: coordinates,
        },
        properties: {
          id: facilityId
        },
      };
      feature_list.push(feature);
    
    // -----------------
    // FRAME (四角形ポリゴン or 階段)
    // -----------------
    } else if (targetNode.type === "FRAME") {
      const { x, y, width, height } = targetNode;

      // ★★★ "stairs" という名前を含むフレームかチェック (小文字/大文字区別なし) ★★★
      if (facilityId.toLowerCase().includes("stairs")) {
        
        // 1. 親フレーム（階段の枠）をポリゴンとして追加
        const boxCoordinates = [[x, y],[x+width, y],[x+width, y+height],[x, y+height],[x,y]].map((v) => {
          return [v[0], frame_height - v[1]]; // Y座標反転
        });
        
        feature_list.push({
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [boxCoordinates],
          },
          properties: {
            id: facilityId // 例: "M-1-stairs-001"
          },
        });

        // 2. フレーム内部の「線」 (VectorNode) を検索
        // findAll で FRAME 内の全 VectorNode を再帰的に検索
        const innerLines = targetNode.findAll(n => n.type === 'VECTOR') as VectorNode[];

        innerLines.forEach((lineVector, index) => {
          // 線は2つの頂点と1つのセグメントで構成されると仮定
          if (lineVector.vectorNetwork.vertices.length === 2 && lineVector.vectorNetwork.segments.length === 1) {
            const v1 = lineVector.vectorNetwork.vertices[0];
            const v2 = lineVector.vectorNetwork.vertices[1];

            // 座標を計算 (フロア基準の絶対座標)
            // (フロア基準) = (階段フレーム座標) + (線ベクター座標) + (ベクター内頂点座標)
            const v1_abs_x = targetNode.x + lineVector.x + v1.x;
            const v1_abs_y = targetNode.y + lineVector.y + v1.y;
            const v2_abs_x = targetNode.x + lineVector.x + v2.x;
            const v2_abs_y = targetNode.y + lineVector.y + v2.y;
            
            const lineCoordinates = [
              [v1_abs_x, frame_height - v1_abs_y], // Y座標反転
              [v2_abs_x, frame_height - v2_abs_y]  // Y座標反転
            ];

            // 連番を "001", "002" ... の形式にフォーマット
            const lineIndex = (index + 1).toString().padStart(3, '0');
            const lineId = `${facilityId}-line-${lineIndex}`;

            feature_list.push({
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: lineCoordinates,
              },
              properties: {
                id: lineId,
                parentId: facilityId,
                category: "stairs-hatch"
              },
            });
          }
        });

      } else {
        // ★★★ "stairs" ではない、通常のFRAMEの処理 ★★★
        const coordinates = [[x, y],[x+width, y],[x+width, y+height],[x, y+height],[x,y]].map((v) => {
          return [v[0], frame_height - v[1]]; // Y座標反転
        });
        const feature: GeoJsonFeature = {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [coordinates],
          },
          properties: {
            id: facilityId
          },
        };
        feature_list.push(feature);
      }

    // -----------------
    // STAR (星形 -> 四角い枠 + shapeTypeプロパティ) ★追加箇所
    // -----------------
    } else if (targetNode.type === "STAR") {
        const { x, y, width, height } = targetNode;
        // バウンディングボックス（四角形）として座標を作成
        const coordinates = [[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]].map((v) => {
          return [v[0], frame_height - v[1]];
        });

        const feature: GeoJsonFeature = {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [coordinates],
          },
          properties: {
            id: facilityId,
            shapeType: "STAR" // ★ここにSTAR識別子を追加
          },
        };
        feature_list.push(feature);

    // -----------------
    // ELLIPSE (ポイント)
    // -----------------
    } else if (targetNode.type === "ELLIPSE") {
      const centerX = targetNode.x + targetNode.width / 2;
      const centerY = targetNode.y + targetNode.height / 2;
      const radius = targetNode.width / 2;

      const feature: GeoJsonFeature = {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [centerX, frame_height - centerY], // Y座標反転
        },
        properties: {
          id: facilityId,
          radius: radius,
        },
      };
      feature_list.push(feature);
    }
    
  }); // targetNodes.forEach
  
  return feature_list;
}

// -----------------------------------------------------------------
// 4. メイン処理
// -----------------------------------------------------------------

// UIを表示
figma.showUI(__html__, { width: 500, height: 500 });

// 選択中のオブジェクトを取得
const selection = figma.currentPage.selection;

if (selection.length !== 1 || selection[0].type !== 'FRAME') {
  figma.ui.postMessage({ type: 'error', message: '親となるフレームを1つだけ選択してください。' });
} else {
  const selectedFrame = selection[0];
  
  // 選択したフレームの直下にある子フレーム（例: "1F", "2F"）を対象とする
  const target_frames = selectedFrame.children.filter((child): child is FrameNode => child.type === 'FRAME');
  
  if (target_frames.length === 0) {
    figma.ui.postMessage({type: "error", message: "選択したフレーム内に、各フロアとなる子フレームを配置してください。"});
  } else {
    
    // フロアごとのデータを格納する配列
    const allFloorsData: { frameId: string; geoJson: GeoJsonFeatureCollection }[] = [];

    target_frames.forEach(one_floor_frame => {
      // 各フロア（例: "1F"）のフィーチャーリストを生成
      const features = generate_feature_list_from_one_frame(one_floor_frame);

      // フロアIDとGeoJSONデータのペアを配列に追加
      allFloorsData.push({
        frameId: one_floor_frame.name, // "1F", "2F" など
        geoJson: {
          type: "FeatureCollection",
          features: features
        }
      });
    });

    if (allFloorsData.length > 0) {
      // データをUI側に送信
      figma.ui.postMessage({
        type: 'export-geojson-all-floors',
        data: JSON.stringify(allFloorsData, null, 2),
        filenamePrefix: selectedFrame.name // 親フレームの名前をファイル名に利用
      });
    } else {
      figma.ui.postMessage({ type: 'error', message: '処理できるオブジェクトが見つかりませんでした。' });
    }
  }
}