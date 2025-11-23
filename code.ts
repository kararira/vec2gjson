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
      if (orderedVertexIndices.length >= 3) { // 3頂点以上なら処理
        const orderedVertices = orderedVertexIndices.map(index => targetNode.vectorNetwork.vertices[index]);

        const coordinates = [orderedVertices.map(v => {
          const absoluteX = targetNode.x + v.x;
          const absoluteY = targetNode.y + v.y;
          return [absoluteX, frame_height - absoluteY]; // Y座標を反転
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
              return [absoluteX, frame_height - absoluteY];
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
      }

      // -----------------
      // FRAME (四角形ポリゴン or 階段)
      // -----------------
    } else if (targetNode.type === "FRAME") {
      const { x, y, width, height } = targetNode;

      // ★★★ "stairs" という名前を含むフレームかチェック (小文字/大文字区別なし) ★★★
      if (facilityId.toLowerCase().includes("stairs")) {

        // 1. 親フレーム（階段の枠）をポリゴンとして追加
        const boxCoordinates = [[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]].map((v) => {
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

        // 2. フレーム内部の「線」または「図形」 (VectorNode) を検索
        // findAll で FRAME 内の全 VectorNode を再帰的に検索
        const innerLines = targetNode.findAll(n => n.type === 'VECTOR') as VectorNode[];

        innerLines.forEach((lineVector, index) => {
          const v_len = lineVector.vectorNetwork.vertices.length;
          const s_len = lineVector.vectorNetwork.segments.length;

          // A. 単純な直線 (LineString)
          if (v_len === 2 && s_len === 1) {
            const v1 = lineVector.vectorNetwork.vertices[0];
            const v2 = lineVector.vectorNetwork.vertices[1];

            // 座標を計算 (フロア基準の絶対座標)
            const v1_abs_x = targetNode.x + lineVector.x + v1.x;
            const v1_abs_y = targetNode.y + lineVector.y + v1.y;
            const v2_abs_x = targetNode.x + lineVector.x + v2.x;
            const v2_abs_y = targetNode.y + lineVector.y + v2.y;

            const lineCoordinates = [
              [v1_abs_x, frame_height - v1_abs_y],
              [v2_abs_x, frame_height - v2_abs_y]
            ];

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

            // ★★★ B. 三角形などの閉じた図形 (Polygon) ★★★
            // ここが「Figmaで作られた三角形」を処理する部分です
          } else if (v_len >= 3) {
            const orderedVertexIndices = traceSingleLoop(lineVector.vectorNetwork.segments);

            // ちゃんとループになっているか確認
            if (orderedVertexIndices.length >= 3) {
              const orderedVertices = orderedVertexIndices.map(ind => lineVector.vectorNetwork.vertices[ind]);

              const polyCoordinates = [orderedVertices.map(v => {
                // 座標計算
                const absoluteX = targetNode.x + lineVector.x + v.x;
                const absoluteY = targetNode.y + lineVector.y + v.y;
                return [absoluteX, frame_height - absoluteY];
              })];

              // 始点と終点を閉じる
              if (polyCoordinates.length > 0 && polyCoordinates[0].length > 0) {
                polyCoordinates[0].push(polyCoordinates[0][0]);
              }

              const shapeIndex = (index + 1).toString().padStart(3, '0');

              feature_list.push({
                type: "Feature",
                geometry: {
                  type: "Polygon", // ★Polygonとして出力
                  coordinates: polyCoordinates,
                },
                properties: {
                  id: `${facilityId}-shape-${shapeIndex}`,
                  parentId: facilityId,
                  category: "stairs-arrow-head" // ★識別しやすいカテゴリ名を付与
                },
              });
            }
          }
        });

      } else {
        // ★★★ "stairs" ではない、通常のFRAMEの処理 ★★★
        const coordinates = [[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]].map((v) => {
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
      // STAR (星形 -> 四角い枠 + shapeTypeプロパティ)
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
          shapeType: "STAR"
        },
      };
      feature_list.push(feature);

      // -----------------
      // ELLIPSE (ポイント)
      // -----------------
    } else if (targetNode.type === "ELLIPSE") {
      const { x, y, width, height, arcData, rotation } = targetNode;
      const radiusX = width / 2;
      const radiusY = height / 2;

      // 回転の中心座標（Figmaの座標系での中心）
      // ※Figmaのx,yは回転前のバウンディングボックスの左上とは限らないため、
      //  width/2, height/2 のオフセットを回転行列で回して中心を求める必要がありますが、
      //  ここでは簡易的に「ノードの中心」を取得するためにバウンディングボックス計算を行います。

      // ★回転を考慮した中心点の算出（ここが重要）
      // FigmaのAPIでは中心座標が直接取れないため、三角関数で補正します
      const theta = -rotation * (Math.PI / 180); // Figmaの回転角度をラジアンに変換(時計回りが正なので反転)

      // ローカル座標系での中心
      const localCx = width / 2;
      const localCy = height / 2;

      // 回転後の中心位置のオフセットを計算
      // (Figmaの x, y は「回転した後の矩形の左上」ではなく、変形の基準点)
      // 正確には描画しながら絶対座標を計算するほうが確実ですが、
      // ここでは「見た目の中心」を基準に円を描きます。
      const centerX = x + width / 2;
      const centerY = y + height / 2;

      // ポリゴンの頂点数（カクカク解消のため32〜64くらいに増やす）
      const steps = 64;
      const polygonCoords: number[][] = [];

      let startAngle = 0;
      let endAngle = Math.PI * 2;

      if (arcData) {
        startAngle = arcData.startingAngle;
        endAngle = arcData.endingAngle;
      }

      // 円弧の長さ
      let sweep = endAngle - startAngle;

      // 回転角度（ラジアン）
      // Figmaのrotationプロパティをそのまま足します
      // Figmaのrotationは時計回りが正。三角関数も時計回りに合わせるか、符号を調整
      const rotationRad = rotation * (Math.PI / 180);

      // 頂点生成ループ
      for (let i = 0; i <= steps; i++) {
        // 現在の描画角度（円のローカル角度）
        const currentLocalAngle = startAngle + (sweep * (i / steps));

        // 回転分を加算する（これで180度回転などが反映される）
        const finalAngle = currentLocalAngle + rotationRad;

        // 座標計算
        const px = centerX + radiusX * Math.cos(finalAngle);
        const py = centerY + radiusY * Math.sin(finalAngle);

        polygonCoords.push([px, frame_height - py]);
      }

      // 半円の場合は中心に戻して閉じる（扇形にする）
      const isFullCircle = Math.abs(sweep - Math.PI * 2) < 0.01;
      if (!isFullCircle) {
        polygonCoords.push([centerX, frame_height - centerY]);
      }

      // 念のため始点と終点を閉じる
      if (polygonCoords.length > 0) {
        const first = polygonCoords[0];
        const last = polygonCoords[polygonCoords.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          polygonCoords.push(first);
        }
      }

      const feature: GeoJsonFeature = {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [polygonCoords],
        },
        properties: {
          id: facilityId,
          shapeType: "ELLIPSE_POLYGON",
          rotation: rotation // デバッグ用にプロパティにも入れておく
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
    figma.ui.postMessage({ type: "error", message: "選択したフレーム内に、各フロアとなる子フレームを配置してください。" });
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