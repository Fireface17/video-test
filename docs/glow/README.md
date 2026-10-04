# Glowing In The Dark — клип

Клип для песни Fireface17 «Glowing In The Dark», сделанный тем же способом, что и клип про P(doom) в этом репозитории: каждый кадр рисует код (three.js, 3D), текст подсвечивается пословно ровно тогда, когда его поют, движение и склейки привязаны к битам. Превью в браузере и финальный рендер дают одинаковые кадры.

- Замысел и план по сценам: [`TREATMENT.md`](TREATMENT.md)
- Как устроены сцены и 3D-инструменты: [`SCENES.md`](SCENES.md)

## Где что лежит

- `audio/glowing-in-the-dark.mp3` — трек; `lyrics/glowing-in-the-dark.txt` — текст.
- `data/glow/lyrics.json` — текст в том виде, как его поют, со временем каждого слова; `data/glow/audio.json` — биты (темп плавно растёт со 150,1 до 152,3 BPM), такты, секции, огибающие громкости, удары и вокальные чопы.
- `analysis/glow/` — скрипты, которые получили эти данные (отделение вокала, распознавание, выравнивание текста по голосу, анализ ритма).
- `app/src/glow/` — клип: `timeline.ts` (монтаж), `scenes/` (сцены), `lib/` (общие 3D-инструменты).
- `app/src/songs.ts` — список песен; по умолчанию открывается эта, клип про P(doom) — `?song=pdoom`.

## Посмотреть на Mac

Нужны [bun](https://bun.sh), Google Chrome и ffmpeg:

```sh
brew install oven-sh/bun/bun ffmpeg   # если ещё не стоят
cd app
bun install
bunx vite
```

Открой http://localhost:5173. Пробел — пуск/пауза, ←/→ — ±1 с (с Shift — ±5 с), `[`/`]` — предыдущая/следующая сцена, `l` — зациклить сцену, `h` — спрятать панель. `?t=44` — начать с 44-й секунды.

## Финальный рендер на MacBook Air M5

Подключи зарядку и не закрывай крышку (закрытый MacBook засыпает). `caffeinate` не даст ему уснуть, пока идёт рендер:

```sh
cd app
caffeinate -dims bun scripts/render.ts video --samples auto --max-samples 108 --shutter 0.2 --out ../out/glow.mp4
```

- **Что получится:** 1920×1080, 60 кадров/с, x264, звук AAC — файл `out/glow.mp4`.
- **Размытие движения:** каждый кадр — среднее нескольких подкадров. `--samples auto` сам решает, сколько их нужно: 12 для спокойного кадра, 36–108 для быстрых движений.
- **Время:** на Air ждать стоит час-два, точнее покажет счётчик кадров в терминале. Без вентилятора Air со временем сбрасывает частоту, это нормально.
- **Быстрый черновик:** `--samples 4 --preset veryfast` — в разы быстрее, но без плавного размытия.
- **4K:** добавь `--scale 2 --x264 aq-mode=3:rc-lookahead=30`. Это примерно в 4 раза дольше, файл будет большой.

### Рендер частями

Можно рендерить кусками (например, по ночам) и потом склеить без перекодирования:

```sh
bun scripts/render.ts video --samples auto --max-samples 108 --shutter 0.2 --from 0 --to 120 --out ../out/part1.mp4
bun scripts/render.ts video --samples auto --max-samples 108 --shutter 0.2 --from 120 --to 227.73 --out ../out/part2.mp4
printf "file 'part1.mp4'\nfile 'part2.mp4'\n" > ../out/parts.txt
ffmpeg -f concat -safe 0 -i ../out/parts.txt -c copy ../out/glow.mp4
```

Границы кусков лучше ставить на склейки сцен (они видны в превью на полосе под кадром).

## Кадры и проверки

```sh
cd app
bun scripts/render.ts stills --t 44.6,72.5,186.5 --out ../out/stills        # отдельные кадры в PNG
bun scripts/render.ts sheet --cuts --out ../out/cuts.png                    # кадры вокруг каждой склейки
```

В облаке (Linux без видеокарты) перед этими командами нужно `export CHROME_PATH=/opt/pw-browsers/chromium`: WebGL тогда считается на процессоре, кадр выходит тот же, только медленнее.

## Пересчитать тайминги

Нужно, только если меняется трек или текст. В `analysis/glow/` (Python через [uv]; модели скачиваются с GitHub, около 1,3 ГБ, в `analysis/.cache/`):

```sh
cd analysis/glow
ffmpeg -i ../../audio/glowing-in-the-dark.mp3 -map 0:a -ar 44100 -c:a pcm_f32le work/mix.wav
uv run python separate.py            # вокал / минус
uv run python transcribe.py          # что и где поётся на самом деле
uv run python emissions.py large mono && uv run python emissions.py large L && uv run python emissions.py large R
uv run python analyze.py --plots     # data/glow/audio.json
uv run python align.py --plots       # data/glow/lyrics.json (строки «как поют» заданы в начале align.py)
```

[uv]: https://docs.astral.sh/uv/
