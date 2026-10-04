# Motion capture

The clips in this folder (`<subject>_<trial>.bvh`, see `INDEX.md`) come from the **CMU Graphics Lab Motion
Capture Database** (http://mocap.cs.cmu.edu/), in the BVH conversion by Bruce Hahne (cgspeed), via
https://github.com/una-dinosauria/cmu-mocap. They were reduced from 120 to 30 frames per second, rounded to
two decimals, and the T-pose reference frame at the start of each clip was dropped.

> The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding
> from NSF EIA-0196217.

CMU's terms: the motion data is free to use in research and in commercial products (such as this video); it
may not be resold as data. The clips are retargeted onto the bodies at run time by `app/src/glow/lib/motion.ts`.
