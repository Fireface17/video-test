# План трека: melancholic jumpstyle phonk (по мотивам test.mp3)

## Бриф (ответы)

- Референс: **test.mp3** (TWXNY — Heavenly jumpstyle, slowed). Цепляет: jumpstyle-перегруз и вокал со словами.
- Темп оригинала: быстрый → **145 BPM**. Slowed ×0.8 = **116 BPM** — ровно темп референса.
- Вокал: **женский, воздушный, английский**, короткий текст-хук. Тема: **потеря, «ты ушла»**.
- Настроение: меланхоличное. Эдиты: **аниме / игры**, TikTok/Reels.
- Инструменты: Suno Pro/Premier, **только модель v6** (без mini и wild).
- Хук: **вариант A** — «you said forever / then you were gone».
- Формат: **полноценная песня ~2 мин** (куплеты, припевы, бридж); эдиторы сами режут припев. Полный текст — `LYRICS.md`.

## Отличия от базового montagem-флоу

- Флоу бракует поющийся вокал (критерий 9). Здесь вокал — сам хук, поэтому правило меняется так:
  **первые 2 секунды без голоса, текст — 2 строки, повтор один-в-один в каждом дропе**.
- Тональность ми минор, как у референса; саб E1 = 41.2 Гц.

## Мотив и гармония

- Аккорды: **Em – C** (i – ♭VI), по такту на аккорд.
- Мотив (пианино/колокол, 4 ноты на такт): **E – D – C – B**. Ритм: доля 1, «и» 2-й, доля 3, доля 4 (держать).
  Запасной вариант: **E – C – E – B↓** (прыжок вниз на кварту).

## Тайминг-карта, 145 BPM

Доля 413.8 мс · такт 1.655 с · 8 тактов 13.241 с · паузы 1/8 = 207 мс, 1/4 = 414 мс.

| Время | Такты | Событие |
|---|---|---|
| 0:00.000 | 1–2 | Мотив соло, сухой, атака на нулевом сэмпле, без голоса |
| 0:03.103 | конец 2 | FREEZE 1: 207 мс |
| 0:03.310 | 3–10 | ДРОП 1 — jumpstyle-кик + 808 + мотив + вокал-хук |
| 0:16.138 | конец 10 | FREEZE 2: 414 мс |
| 0:16.552 | 11–26 | ДРОП 2 — + мотив октавой выше |
| 0:43.034 | 27–30 | BREAK — мотив + голос без барабанов |
| 0:49.655 | 31–46 | ДРОП 3 — максимальная плотность |
| 1:16.138 | 47–50 | Аутро, жёсткий обрыв |
| 1:22.759 | | конец |

Slowed ×0.8: всё × 1.25 → дроп 2 на 0:20.690, конец 1:43.448.

## Фаза 1 — поиск лупа (Custom, Instrumental ON, v6)

Пошагово с каждой кнопкой — `STEPS.md`.

Style — по одному варианту за прогон:
```
melancholic jumpstyle phonk, 145 BPM, E minor, sad piano hook, punchy jumpstyle kick, deep 808
```
```
sad anime phonk, jumpstyle bounce, 145 BPM, E minor, bell lead, choir pad, heavy 808
```
```
slowed sad jumpstyle, 145 BPM, E minor, 4-note piano motif, hard kick, deep sub, loop
```
Exclude: `guitar, rap, orchestral strings`

| Контрол | v6 |
|---|---|
| Style Influence | 80 |
| Weirdness | 45 |
| Variety | **0** |
| Max Mode | off |
| Длина | ~45 с |
| Генераций | 6 (по 2 на промпт) |

Отбраковка по первым 8 с — критерии 1–8 флоу. Годный луп скачать или сразу вести в Cover.

## Фаза 2 — трек с вокалом (Cover по своему лупу, Instrumental OFF, v6)

Style:
```
melancholic jumpstyle phonk, 145 BPM, E minor, airy female vocal, sad piano hook, jumpstyle kick, deep 808
```
Exclude: `rap, male vocals, guitar`

| Контрол | Значение |
|---|---|
| Style Influence | 60 |
| Audio Influence | 65 (коридор 55–85) |
| Weirdness | 30 |
| Variety | **0** |
| Max Mode | ON |
| Длина | ~1:30 |

Lyrics:
```
[Intro | piano motif alone, dry, no drums, no vocal, hit on the very first beat]

[Drop | jumpstyle kick and 808 enter on beat one, motif unchanged, airy female vocal]
you said forever
then you were gone

[Drop | motif unchanged, doubled one octave up, same female vocal]
you said forever
then you were gone

[Break | motif alone, no drums, soft female vocal, two bars]
i still hear you
in an empty room

[Drop | full arrangement, loudest, motif unchanged, same female vocal]
you said forever
then you were gone

[Outro | drums cut, last motif hit]
[End]
```

Калибровка (один ползунок за тест): пианино уплыло → Audio Influence +10; вернулся почти сам луп →
Audio Influence −10; жанр поплыл → Style Influence +10; вокал поёт новые слова или куплеты → сменить строку (v6)
или A/B с голыми тегами.

## Фаза 3 — REAPER и версии

- Freeze по карте выше, фейды 3 мс, ripple OFF.
- Параллельный перегруз (HPF 300 / LPF 6k → Waveshaping, −12 дБ): тот самый jumpstyle-«клип», но саб остаётся чистым.
- Мастер −9.5 LUFS-I, −1.0 dBTP. Референсы на −6 LUFS с пиком выше 0 — громче не станет, нормализация сравняет.
- Версии: **Slowed ×0.8 (116 BPM, preserve pitch OFF, ReaVerbate 1.2 с)** — главная для эдитов;
  Super Slowed ×0.7 (101.5 BPM); TikTok-луп 8 тактов от 0:16.552 до 0:29.793 (в slowed: 0:20.690–0:37.241).

## Названия-кандидаты

FOREVER GONE · EMPTY ROOM · YOU SAID FOREVER — и (Slowed) отдельным релизом.

## Нельзя

test.mp3 и другие чужие треки в Suno не загружать (ToS + производное произведение). В Cover идёт только свой луп из фазы 1.
