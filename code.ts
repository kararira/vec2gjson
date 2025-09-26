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
    id: string;
  };
}

// ★★★ 追加: 1つの閉路を前提とした、よりシンプルなパス追跡関数 ★★★
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
      // 次に繋がるセグメントが見つからなかった場合（＝閉じていないパスなど）
      // ループを終了して、それまでの結果を返す
      break; 
    }
  }

  // 始点と終点が同じになっているはずなので、最後の要素を削除して重複を防ぐ
  if (orderedIndices[0] === orderedIndices[orderedIndices.length - 1]) {
    orderedIndices.pop();
  }

  return orderedIndices;
}

const generate_feature_list_from_one_frame = (one_frame: FrameNode) => {
  const feature_list: GeoJsonFeature[] = [];

  const frame_height = one_frame.height;

  // const vectorNodes = one_frame.findAll(node => node.type === 'VECTOR') as VectorNode[];
  const targetNodes = one_frame.children;
  if (targetNodes.length === 0) {
    figma.ui.postMessage({ type: 'error', message: '選択されたフレーム内にベクターオブジェクトが見つかりませんでした。' });
    
  } else {
    targetNodes.forEach(targetNode => {
      const facilityId = targetNode.name;
      // const nameParts = targetNode.name.split(',').map(part => part.trim());
      // if (nameParts.length == 0) { return; }

      // const [facilityName, category] = nameParts;
      // const floor = parseInt(floorStr, 10);
      // if ((!floor)) { return; }

      if (targetNode.type === "VECTOR") {
        // ★変更点: 新しいtraceSingleLoop関数を呼び出す
        const orderedVertexIndices = traceSingleLoop(targetNode.vectorNetwork.segments);
        if (orderedVertexIndices.length < 3) return; // 3頂点未満はポリゴンにできない
        // 取得したインデックスの順序で、頂点オブジェクトの配列を再構築
        const orderedVertices = orderedVertexIndices.map(index => targetNode.vectorNetwork.vertices[index]);
      
        // ★変更点3: 各頂点の座標を基準オブジェクトからの相対座標に変換
        const coordinates = [orderedVertices.map(v => {
          // 頂点の絶対座標 = ベクター自体の座標 + ベクター内の頂点座標
          const absoluteX = targetNode.x + v.x;
          const absoluteY = targetNode.y + v.y;
          // 絶対座標から基準オブジェクトの座標を引く
          return [ absoluteX, frame_height - absoluteY];
        })];

        if (coordinates.length > 0) {
          coordinates[0].push(coordinates[0][0]);
        }

        //内部に空洞があるような図形はcoordinatesにループの座標を追加する
        if (targetNode.vectorNetwork.regions !== undefined && targetNode.vectorNetwork.regions.length !== 0) {
          console.log(targetNode.parent?.name, targetNode.name);
          console.log(targetNode.vectorNetwork.regions[0].loops);
          targetNode.vectorNetwork.regions[0].loops.slice(1).forEach((loop) => {
            console.log(`loopだよ: ${loop}`);
            const now_segments: VectorSegment[] = loop.map(segment_index => targetNode.vectorNetwork.segments[segment_index]);
            const orderedVertexIndices = traceSingleLoop(now_segments);
            if (orderedVertexIndices.length < 3) return; // 3頂点未満はポリゴンにできない
            // 取得したインデックスの順序で、頂点オブジェクトの配列を再構築
            const orderedVertices = orderedVertexIndices.map(index => targetNode.vectorNetwork.vertices[index]);
            coordinates.push(orderedVertices.map(v => {
              // 頂点の絶対座標 = ベクター自体の座標 + ベクター内の頂点座標
              const absoluteX = targetNode.x + v.x;
              const absoluteY = targetNode.y + v.y;
              // 絶対座標から基準オブジェクトの座標を引く
              return [ absoluteX, frame_height - absoluteY];
            }));
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
      } else if (targetNode.type === "FRAME") {
        const { x, y, width, height } = targetNode;
        const coordinates = [[x, y],[x+width, y],[x+width, y+height],[x, y+height],[x,y]].map((v) => {
          return [v[0], frame_height-v[1]];
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

      
    });
  }
  return feature_list;
}

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
  const target_frames = selectedFrame.children.filter((child): child is FrameNode => child.type === 'FRAME');
  if (target_frames.length === 0) {
    figma.ui.postMessage({type: "error", message: "選択したフレーム内にフレームが存在するようにしてください"});
  }

  // ★★★ 変更点: フロアごとのデータを格納する配列を作成 ★★★
  const allFloorsData: { frameId: string; geoJson: GeoJsonFeatureCollection }[] = [];

  target_frames.forEach(one_frame => {
    // 各フロアのフィーチャーリストを生成
    const features = generate_feature_list_from_one_frame(one_frame);

    // フロアIDとGeoJSONデータのペアを配列に追加
    allFloorsData.push({
      frameId: one_frame.name, // or one_frame.id
      geoJson: {
        type: "FeatureCollection",
        features: features
      }
    });
  });

  if (allFloorsData.length > 0) {
    figma.ui.postMessage({
      type: 'export-geojson-all-floors', // ★ メッセージタイプを変更
      data: JSON.stringify(allFloorsData, null, 2),
      filenamePrefix: "" // ファイル名のプレフィックス
    });
  } else {
    figma.ui.postMessage({ type: 'error', message: '処理できるオブジェクトが見つかりませんでした。' });
  }
}

//postMessageは一度の実行で一度だけ（一度以上はあとに送ったもので上書きされる