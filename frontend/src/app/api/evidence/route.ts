import {NextResponse} from 'next/server';
import {getEvidenceByProofHash, listRecentEvidence} from '../../../server/evidenceStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const {searchParams} = new URL(request.url);
  const proofHash = searchParams.get('proofHash')?.trim();

  if (proofHash) {
    const found = getEvidenceByProofHash(proofHash);
    if (!found) {
      return NextResponse.json({error: 'Không tìm thấy hồ sơ bằng chứng cho proofHash này.'}, {status: 404});
    }
    return NextResponse.json(found);
  }

  return NextResponse.json({items: listRecentEvidence(30)});
}
