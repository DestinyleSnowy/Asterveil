我们不使用复杂的向量公式，就用空间几何 + 勾股定理一步一步做。

## 第一步：先画出关键的结构

题目告诉我们：

- \\(PA\perp PB\\)
- \\(\angle APC=60^\circ\\)
- \\(\angle BPC=60^\circ\\)

我们要求的是直线 \\(PC\\) 与平面 \\(PAB\\) 所成角的正弦。

![【探究】なぜ三角錐の頂点から下ろした垂線の足は「外心」になるのか？｜さるわたり　ゆうすけ](https://images.openai.com/static-rsc-4/PhBdBOJuP49J8vwWtqxhZyzu0WYlhZB_Lk9TWQfyng-NotnY2a7LLhc7bZ1bhHznNQI9XVnTKHC3tMN4xxmTgDnrIPW_rAPqvpxl1FUx0z6w4Ss2tGNgGWV0RIW_5Jsfw7MOZjXKTbJvTsEiGa-VFJBPyar5KIiLZNEe6zHmHFc?purpose=inline)

想象从点 C 向平面 PAB 作垂线，垂足记为 H。

于是 \\(CH\perp\\) 平面 \\(PAB\\)，而 \\(PH\\) 就是 \\(PC\\) 在平面上的投影。

所以，设所成角为 \\(\theta\\)，有

\\[ \boxed{\sin\theta=\frac{CH}{PC}} \\]

现在问题变成了：如何求 \\(CH\\) 与 \\(PC\\) 的关系？

## 第二步：利用两个 \\(60^\circ\\)

因为 \\(\angle APC=60^\circ\\)，在 \\(PC\\) 方向上，沿着 \\(PA\\) 的投影长度为

\\[ PC\cos60^\circ=\frac{PC}{2} \\]

同理，因为 \\(\angle BPC=60^\circ\\)，沿着 \\(PB\\) 的投影长度也是

\\[ \frac{PC}{2} \\]

也就是说，\\(PC\\) 在 \\(PA\\)、\\(PB\\) 两个互相垂直的方向上的分量，恰好都是 \\(PC/2\\)。

而 \\(PA\perp PB\\)，所以由勾股定理：

\\[ PH^2=\left(\frac{PC}{2}\right)^2+ \left(\frac{PC}{2}\right)^2 \\]

整理得

\\[ PH^2=\frac{PC^2}{2} \\]

## 第三步：求垂直高度 \\(CH\\)

因为 \\(CH\perp PH\\)，所以三角形 \\(PCH\\) 是直角三角形。

再次使用勾股定理：

\\[ \begin{aligned} CH^2&=PC^2-PH^2\\\ &=PC^2-\frac{PC^2}{2}\\\ &=\frac{PC^2}{2} \end{aligned} \\]

因此

\\[ CH=\frac{PC}{\sqrt2} \\]

代回第一步：

\\[ \sin\theta=\frac{CH}{PC} =\frac{PC/\sqrt2}{PC} =\boxed{\frac{\sqrt2}{2}} \\]

这道题最关键的思路：

两个 \\(60^\circ\\) 让 \\(PC\\) 在 \\(PA\\)、\\(PB\\) 方向上的分量都等于 \\(PC/2\\)；再利用 \\(PA\perp PB\\)，就能算出 \\(PC\\) 在平面内的投影长度，最后用勾股定理求出垂直高度。
