interface FeedbackPayload {
  type?: 'Bug' | 'Feature';
  message?: string;
  user_email?: string;
  image_url?: string;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return Response.json({ success: false, error: 'Method not allowed.' }, { status: 405 });
  }

  try {
    const webhookUrl = Deno.env.get('SLACK_WEBHOOK_URL');
    if (!webhookUrl) {
      return Response.json({ success: false, error: 'Feedback endpoint is not configured.' }, { status: 500 });
    }

    const payload = (await request.json()) as FeedbackPayload;
    const type = payload.type === 'Feature' ? 'Feature' : 'Bug';
    const message = payload.message?.trim() ?? '';

    if (!message) {
      return Response.json({ success: false, error: 'Message is required.' }, { status: 400 });
    }

    const emailLine = payload.user_email?.trim() ? `\n*Email:* ${payload.user_email.trim()}` : '';
    const imageUrl = payload.image_url?.trim() ?? '';
    const imageLine = imageUrl ? `\n\n*Attached Image:*\n${imageUrl}` : '';
    const slackResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `*Bug Pocket Support (${type})*${emailLine}\n\n${message}${imageLine}`
      })
    });

    if (!slackResponse.ok) {
      return Response.json({ success: false, error: 'Feedback delivery failed.' }, { status: 502 });
    }

    return Response.json({ success: true });
  } catch (_error) {
    return Response.json({ success: false, error: 'Feedback delivery failed.' }, { status: 500 });
  }
});