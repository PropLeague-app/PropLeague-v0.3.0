import { supabase } from '../lib/supabaseClient';

type ServiceResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export function getLogoPublicUrl(storagePath: string): string {
  return supabase.storage.from('logos').getPublicUrl(storagePath).data.publicUrl;
}

function extensionFor(file: File): string {
  const fromName = file.name.split('.').pop();
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  return file.type.split('/')[1] ?? 'jpg';
}

export async function uploadTeamLogo(teamId: string, file: File): Promise<ServiceResult<{ publicUrl: string }>> {
  const path = `team-logos/${teamId}.${extensionFor(file)}`;
  const { error: uploadError } = await supabase.storage.from('logos').upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) return { ok: false, error: uploadError.message };

  // .select().single() is deliberate, not decoration: a plain .update() call
  // doesn't surface an error when RLS silently blocks it (0 rows affected,
  // dbError stays null) — .single() forces PostgREST to error if the row wasn't
  // actually touched, which is what catches "you don't own this team" here.
  const { error: dbError } = await supabase.from('teams').update({ logo_storage_path: path }).eq('id', teamId).select('id').single();
  if (dbError) return { ok: false, error: 'Uploaded, but could not save it — you may not have permission to edit this team.' };

  // Cache-bust: the path is stable (upsert overwrites the same file), so without
  // this the browser/CDN would keep showing the old cached image after a re-upload.
  return { ok: true, publicUrl: `${getLogoPublicUrl(path)}?t=${Date.now()}` };
}

export async function uploadLeagueLogo(leagueId: string, file: File): Promise<ServiceResult<{ publicUrl: string }>> {
  const path = `league-logos/${leagueId}.${extensionFor(file)}`;
  const { error: uploadError } = await supabase.storage.from('logos').upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { error: dbError } = await supabase.from('leagues').update({ logo_storage_path: path }).eq('id', leagueId).select('id').single();
  if (dbError) return { ok: false, error: 'Uploaded, but could not save it — only the commissioner can change the league logo.' };

  return { ok: true, publicUrl: `${getLogoPublicUrl(path)}?t=${Date.now()}` };
}
