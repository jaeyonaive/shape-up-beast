const KEY = 'fitnasia_user_id';

export function getUserId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = 'user_' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem(KEY, id);
  }
  return id;
}
