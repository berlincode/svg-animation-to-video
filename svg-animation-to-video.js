// vim: sts=2:ts=2:sw=2

const fs = require('fs');
const puppeteer = require('puppeteer');
const url = require('url');
const {Converter} = require('ffmpeg-stream');

var options     = {
  headless: true,
  args: [
  ],
};

const zeroPad = (num, places) => String(num).padStart(places, '0');

const stringToUrlString = (s) => {
  try {
    new URL(s);
    // is already a valid url
    return s;
  } catch (err) {
    // make a url from (relative) file 
    return url.pathToFileURL(s).href;
  }
};

async function main() {
  const documentUrl = stringToUrlString(process.argv[2] || 'example_animation.html');
  const selector = process.argv[3] || 'svg';
  const framesPerSecond = parseFloat(process.argv[4] || '25');
  const oversampling = parseInt(process.argv[5] || '1');
  const startSecond = parseFloat(process.argv[6], '0.0');
  const seconds = parseFloat(process.argv[7], '1.0');
  const exportname = process.argv[8] || 'output.webm';

  if (fs.existsSync(exportname)) {
    throw Error(`Errror: output file "${exportname}" already exists!`);
  }

  const browser = await puppeteer.launch(options);
  const pages = await browser.pages();
  const page = pages[0];
  await page.goto(documentUrl, {waitUntil: 'networkidle2'});

  const basename = 'tmp';

  const converter = new Converter();

  // get a writable input stream and pipe an image file to it
  const converterInput = converter.createInputStream({
    f: 'image2pipe',
    vcodec: 'png',
    i:'-',
    r: framesPerSecond*oversampling,
  });
  converter.output(
    exportname,
    {
      vcodec: 'ffv1', //.mkv / lossless and supports alpha
      pix_fmt: 'yuva420p', // with alpha channel
      vf: `tmix=${oversampling}`, // interpolate <oversampling> frames to create a motion blur effect
      r: framesPerSecond,
    }
  );

  let frames = [];

  const element = await page.$(selector);
  const svg = await page.$('svg');

  await page.evaluate(() => document.body.style.background = 'transparent');

  await page.evaluate((svg) => {
    svg.pauseAnimations();
  }, svg);

  for (let frameIdx = 0 ; frameIdx < framesPerSecond*oversampling*seconds ; frameIdx++){
    console.log(`frame ${frameIdx} / ${Math.trunc(framesPerSecond*oversampling*seconds)}`);
    const filename = `${basename}_${zeroPad(frameIdx)}.png`;

    await page.evaluate((svg, time) => {
      svg.setCurrentTime(time);
    }, svg, startSecond + frameIdx / (framesPerSecond*oversampling));

    await element.screenshot({
      path: filename,
      omitBackground: true,
    });

    frames.push(filename);
  }

  await browser.close();

  frames.map(filename => () =>
    new Promise((fulfill, reject) => {
      fs.
        createReadStream(filename)
        .on('end', fulfill)
        .on('error', reject)
        .pipe(converterInput, {end: false});
    })
  )
    .reduce((prev, next) => prev.then(next), Promise.resolve())
    .then(() => converterInput.end());

  await converter.run();
}

main();
