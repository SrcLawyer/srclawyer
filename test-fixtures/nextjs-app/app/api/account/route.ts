export async function POST(request: Request) {
  const { ssn, dateOfBirth } = await request.json();
  return Response.json({ ok: true, ssn, dateOfBirth });
}
