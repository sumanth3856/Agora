export const getRelativeTime = (timestamp) => {
  const diffInSeconds = Math.floor((Date.now() - timestamp) / 1000);
  if (diffInSeconds < 60) return `${diffInSeconds}s`;
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m`;
  if (diffInMinutes < 1440) {
    return new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const flattenReplies = (replies) => {
  const result = [];
  for (const reply of replies) {
    result.push(reply);
    if (reply.replies?.length > 0) {
      result.push(...flattenReplies(reply.replies));
    }
  }
  return result;
};
