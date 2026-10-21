import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const CHATBOT_ID = '5e484b09-d9ac-425c-ac3b-95b6209e99f0';

// Replicate exact getTopTopics logic (grouped by topic_label)
const { data } = await sb.from('interaction_events')
  .select('topic_category,topic_label,response_status,abstained,retrieval_status')
  .eq('rag_app_id', CHATBOT_ID)
  .eq('event_type', 'question_answered')
  .not('topic_category', 'is', null);

const topicMap = {};
for (const evt of (data || [])) {
  const key = evt.topic_label || evt.topic_category;
  if (!key) continue;
  if (!topicMap[key]) {
    topicMap[key] = { category: evt.topic_category || key, label: key, count: 0 };
  }
  topicMap[key].count++;
}

const total = (data || []).length;
console.log(`Total classified events: ${total}`);
console.log('Topics (by label):');
Object.values(topicMap)
  .sort((a, b) => b.count - a.count)
  .forEach(t => console.log(`  ${t.count}x  ${t.label}  (category: ${t.category})`));
