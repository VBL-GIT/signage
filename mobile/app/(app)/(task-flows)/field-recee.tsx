import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, ScrollView, StyleSheet, Alert, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SignageCaptureList, SignageDraft, makeEmptySignage } from '../../../components/forms/SignageCaptureList';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../../../components/ui/Field';
import { useUpload } from '../../../hooks/useUpload';
import { useDraft } from '../../../hooks/useDraft';
import { DraftBanner } from '../../../components/ui/DraftBanner';
import { fileExists } from '../../../utils/drafts';
import { useAuthStore } from '../../../store/auth.store';
import { useLocation } from '../../../hooks/useLocation';
import { submitFieldRecee, ReceeSignagePayload } from '../../../services/tasks.api';
import { getNearbyStores, NearbyStore } from '../../../services/stores.api';
import { getBrands } from '../../../services/reference.api';
import { apiError } from '../../../services/api';
import { Brand } from '../../../types/domain';
import { Coords, haversineMeters, formatDistance } from '../../../utils/distance';
import { colors, spacing, radius } from '../../../constants/theme';

/**
 * Direct recee of an outlet that nobody assigned. Either records a NEW outlet
 * (details + current GPS) or, when the nearby check finds it already exists,
 * recees that store instead. Submits straight into the normal approval queue.
 */
export default function FieldReceeScreen() {
  // Hidden Tabs.Screen singleton — remount on every visit so drafts never leak.
  const [nonce, setNonce] = useState(0);
  return <FieldRecee key={nonce} onDone={() => setNonce((n) => n + 1)} />;
}

function FieldRecee({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id);
  const { uploadAll, uploading } = useUpload();
  const { capture, loading: locating } = useLocation();

  const [coords, setCoords] = useState<Coords | null>(null);
  const [existing, setExisting] = useState<NearbyStore | null>(null);
  const [nearby, setNearby] = useState<NearbyStore[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [pincode, setPincode] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactNo, setContactNo] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [channel, setChannel] = useState('');
  const [subChannel, setSubChannel] = useState('');
  const [state, setState] = useState('');
  const [notes, setNotes] = useState('');
  const [signages, setSignages] = useState<SignageDraft[]>([makeEmptySignage()]);
  const [submitting, setSubmitting] = useState(false);
  // Same id for every retry of this submission; the server uses it to ignore a
  // repeat whose first attempt actually went through.
  const [requestId] = useState(() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 10)}`);

  type FieldDraft = {
    requestId: string; coords: Coords | null; existing: NearbyStore | null; brandId: string | null;
    name: string; address: string; pincode: string; contactPerson: string; contactNo: string;
    contactEmail: string; channel: string; subChannel: string; state: string; notes: string;
    signages: SignageDraft[];
  };
  const requestIdRef = useRef(requestId);
  const draft = useDraft<FieldDraft>(
    userId ? `${userId}_field-recee` : null,
    { requestId: requestIdRef.current, coords, existing, brandId, name, address, pincode, contactPerson, contactNo,
      contactEmail, channel, subChannel, state, notes, signages },
    {
      isEmpty: (d) => !d.name && !d.address && !d.pincode && !d.existing && !d.notes && !d.contactPerson &&
        !d.contactNo && !d.contactEmail && !d.channel && !d.subChannel && !d.state && !d.brandId &&
        d.signages.every((x) => !x.uri && !x.signage_type),
      onRestore: async (d) => {
        requestIdRef.current = d.requestId || requestIdRef.current;
        setCoords(d.coords); setExisting(d.existing); setBrandId(d.brandId);
        setName(d.name); setAddress(d.address); setPincode(d.pincode);
        setContactPerson(d.contactPerson); setContactNo(d.contactNo); setContactEmail(d.contactEmail);
        setChannel(d.channel); setSubChannel(d.subChannel); setState(d.state); setNotes(d.notes);
        const sg = await Promise.all(d.signages.map(async (x) =>
          (await fileExists(x.uri)) ? x : { ...x, uri: null, coords: null, annotation: null }));
        if (sg.length) setSignages(sg);
      },
    }
  );

  useEffect(() => {
    getBrands().then(setBrands).catch(() => undefined);
  }, []);

  // Capture the outlet's location once the draft has been looked at — a restored
  // draft keeps the position it was started at.
  useEffect(() => {
    if (!draft.hydrated || coords) return;
    capture().then((c) => c && setCoords(c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.hydrated]);

  // Duplicate guard: outlets within ~150 m of here, or matching the typed name.
  const lookupSeq = useRef(0);
  useEffect(() => {
    if (existing) return;
    const seq = ++lookupSeq.current;
    const t = setTimeout(() => {
      getNearbyStores({ lat: coords?.lat, long: coords?.long, q: name.trim() })
        .then((r) => { if (seq === lookupSeq.current) setNearby(r); })
        .catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [coords, name, existing]);

  const storeCoords: Coords | null = existing ? { lat: Number(existing.lat), long: Number(existing.long) } : coords;

  async function handleSubmit() {
    if (!existing) {
      if (!coords) { Alert.alert('Location needed', 'Waiting for your GPS location. Make sure location is on.'); return; }
      if (!name.trim()) { Alert.alert('Required', 'Enter the outlet name'); return; }
      if (!address.trim()) { Alert.alert('Required', 'Enter the outlet address'); return; }
      if (!pincode.trim()) { Alert.alert('Required', 'Enter the pincode'); return; }
    }
    for (let i = 0; i < signages.length; i++) {
      const s = signages[i];
      if (!s.uri || !s.coords) { Alert.alert('Required', `Capture a photo for Signage ${i + 1}`); return; }
      if (!s.signage_type) { Alert.alert('Required', `Select a signage type for Signage ${i + 1}`); return; }
      if (!s.size.boarding_size_id && !(s.size.custom_width_cm && s.size.custom_height_cm)) {
        Alert.alert('Required', `Select a size for Signage ${i + 1}`); return;
      }
    }

    setSubmitting(true);
    try {
      const firstCoords = signages[0].coords!;
      const urls = await uploadAll(signages.map((x) => x.uri!));
      const failed = urls.findIndex((u) => !u);
      if (failed >= 0) {
        Alert.alert('Upload Failed', `Could not upload the photo for Signage ${failed + 1}. Your draft is saved — check your connection and try again.`);
        return;
      }
      const payload: ReceeSignagePayload[] = signages.map((x, i) => ({
        photo_url: urls[i]!,
        lat: x.coords!.lat,
        long: x.coords!.long,
        signage_type: x.signage_type!,
        boarding_size_id: x.size.boarding_size_id,
        custom_width_cm: x.size.custom_width_cm,
        custom_height_cm: x.size.custom_height_cm,
        annotation: x.annotation ?? undefined,
        distance_from_store_m: i === 0 && storeCoords ? haversineMeters(x.coords!, storeCoords) : undefined,
        distance_from_first_m: i > 0 ? haversineMeters(x.coords!, firstCoords) : undefined,
      }));
      const opt = (v: string) => v.trim() || undefined;
      const base = { brand_id: brandId ?? undefined, notes: opt(notes), signages: payload, client_request_id: requestIdRef.current };
      const body = existing
        ? { ...base, store_id: existing.id }
        : {
            ...base,
            outlet: {
              name: name.trim(), address: address.trim(), pincode: pincode.trim(),
              lat: coords!.lat, long: coords!.long,
              contact_person: opt(contactPerson), contact_no: opt(contactNo), contact_email: opt(contactEmail),
              CHANNEL: opt(channel), SUB_CHANNEL: opt(subChannel), STATE_CD: opt(state),
            },
          };
      await submitFieldRecee(body);
      await draft.clear();
      Alert.alert('Recee Submitted', 'Sent for approval.', [{ text: 'OK', onPress: () => { onDone(); router.replace('/(app)/(tasks)'); } }]);
    } catch (e: unknown) {
      Alert.alert('Submission Failed', apiError(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (!draft.hydrated) return <ActivityIndicator style={{ flex: 1 }} size="large" color={colors.primary} />;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <DraftBanner savedAt={draft.restoredAt} onDiscard={async () => { await draft.clear(); onDone(); }} />
        <TouchableOpacity onPress={() => router.replace('/(app)/(tasks)')}><Text style={styles.back}>‹ Back to tasks</Text></TouchableOpacity>
        <Text style={styles.title}>Recee a New Outlet</Text>
        <Text style={styles.sub}>For an outlet that wasn't assigned to you.</Text>

        {existing ? (
          <Card>
            <Text style={styles.label}>Existing outlet</Text>
            <Text style={styles.storeName}>{existing.name}</Text>
            <Text style={styles.addr}>{existing.address}</Text>
            <TouchableOpacity onPress={() => setExisting(null)}><Text style={styles.link}>Not this outlet — enter a new one</Text></TouchableOpacity>
          </Card>
        ) : (
          <>
            {nearby.length > 0 && (
              <Card style={styles.warnCard}>
                <Text style={styles.warnTitle}>Is it one of these existing outlets?</Text>
                {nearby.map((s) => (
                  <TouchableOpacity key={s.id} style={styles.match} onPress={() => setExisting(s)}>
                    <Text style={styles.storeName}>{s.name}</Text>
                    <Text style={styles.addr} numberOfLines={1}>
                      {s.address}{s.distance_m != null ? ` · ${formatDistance(s.distance_m)} away` : ''}
                    </Text>
                    <Text style={styles.link}>Use this outlet</Text>
                  </TouchableOpacity>
                ))}
              </Card>
            )}

            <Text style={locating || coords ? styles.gps : styles.gpsBad}>
              {coords ? `Location captured (${coords.lat.toFixed(5)}, ${coords.long.toFixed(5)})` : locating ? 'Getting your location…' : 'Location not available'}
            </Text>
            <Field label="Outlet name *" value={name} onChangeText={setName} autoCapitalize="words" />
            <Field label="Address *" value={address} onChangeText={setAddress} autoCapitalize="words" />
            <Field label="Pincode *" value={pincode} onChangeText={setPincode} keyboardType="number-pad" />
            <Field label="Contact person" value={contactPerson} onChangeText={setContactPerson} autoCapitalize="words" />
            <Field label="Contact phone" value={contactNo} onChangeText={setContactNo} keyboardType="phone-pad" />
            <Field label="Contact email" value={contactEmail} onChangeText={setContactEmail} keyboardType="email-address" autoCapitalize="none" />
            <Field label="Channel" value={channel} onChangeText={setChannel} />
            <Field label="Sub-channel" value={subChannel} onChangeText={setSubChannel} />
            <Field label="State" value={state} onChangeText={setState} />
          </>
        )}

        <Text style={styles.label}>Brand</Text>
        <View style={styles.chips}>
          {brands.map((b) => (
            <TouchableOpacity key={b.id} onPress={() => setBrandId(brandId === b.id ? null : b.id)}
              style={[styles.chip, brandId === b.id && styles.chipOn]}>
              <Text style={[styles.chipText, brandId === b.id && { color: colors.primary }]}>{b.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <SignageCaptureList storeCoords={storeCoords} value={signages} onChange={setSignages} />

        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput style={styles.input} value={notes} onChangeText={setNotes} multiline
          placeholder="Any notes about the recee..." placeholderTextColor={colors.textMuted} />

        <Button title={submitting || uploading ? 'Submitting…' : 'Submit Recee'} onPress={handleSubmit}
          loading={submitting || uploading} style={styles.btn} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.md, gap: spacing.md, paddingTop: spacing.xl },
  back: { fontSize: 14, fontWeight: '600', color: colors.primary },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  sub: { fontSize: 13, color: colors.textSecondary, marginTop: -8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  gps: { fontSize: 12, color: colors.textSecondary },
  gpsBad: { fontSize: 12, color: colors.danger },
  storeName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  addr: { fontSize: 13, color: colors.textSecondary },
  link: { fontSize: 13, fontWeight: '700', color: colors.primary, marginTop: 4 },
  warnCard: { borderColor: colors.primary, borderWidth: 1, gap: spacing.sm },
  warnTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  match: { paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm, minHeight: 70, textAlignVertical: 'top', color: colors.textPrimary,
  },
  btn: { marginTop: spacing.sm },
});
